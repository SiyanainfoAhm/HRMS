<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;

return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('cirt_payroll_master')) {
            return;
        }

        if (! Schema::hasTable('cirt_payroll_master_history')) {
            DB::statement('CREATE TABLE cirt_payroll_master_history (LIKE cirt_payroll_master INCLUDING DEFAULTS EXCLUDING CONSTRAINTS)');
            DB::statement('ALTER TABLE cirt_payroll_master_history RENAME COLUMN id TO original_master_id');
            DB::statement('ALTER TABLE cirt_payroll_master_history ADD COLUMN history_id UUID PRIMARY KEY DEFAULT gen_random_uuid()');
            DB::statement("ALTER TABLE cirt_payroll_master_history ADD COLUMN archive_action TEXT NOT NULL DEFAULT 'REVISION'");
            DB::statement('ALTER TABLE cirt_payroll_master_history ADD COLUMN archive_reason TEXT NULL');
            DB::statement('ALTER TABLE cirt_payroll_master_history ADD COLUMN is_superseded BOOLEAN NOT NULL DEFAULT false');
            DB::statement('ALTER TABLE cirt_payroll_master_history ADD COLUMN archived_at TIMESTAMPTZ NOT NULL DEFAULT now()');
            DB::statement('ALTER TABLE cirt_payroll_master_history ADD COLUMN archived_by UUID NULL');
            DB::statement('ALTER TABLE cirt_payroll_master_history ADD COLUMN replaced_by_master_id UUID NULL');
            DB::statement('CREATE INDEX idx_cirt_payroll_master_history_employee ON cirt_payroll_master_history (company_id, employee_user_id)');
            DB::statement('CREATE INDEX idx_cirt_payroll_master_history_effective ON cirt_payroll_master_history (company_id, employee_user_id, effective_from, effective_to)');
        }

        $this->migrateDuplicateRowsToHistory();
        $this->normalizeRemainingCurrentRows();
        $this->createUniqueCurrentIndexes();
        $this->createFullHistoryView();
    }

    public function down(): void
    {
        DB::statement('DROP VIEW IF EXISTS cirt_payroll_master_full_history');
        DB::statement('DROP INDEX IF EXISTS ux_cirt_payroll_master_one_current');
        DB::statement('DROP INDEX IF EXISTS ux_cirt_payroll_master_one_current_user');
        Schema::dropIfExists('cirt_payroll_master_history');
    }

    private function migrateDuplicateRowsToHistory(): void
    {
        $rows = DB::table('cirt_payroll_master')->orderBy('company_id')->orderBy('created_at')->get();
        $groups = [];

        foreach ($rows as $row) {
            $key = $this->employeeGroupKey($row);
            $groups[$key][] = $row;
        }

        foreach ($groups as $group) {
            if (count($group) <= 1) {
                continue;
            }

            usort($group, fn ($a, $b) => $this->compareRowsForCurrent($a, $b));
            $keeper = array_shift($group);

            foreach ($group as $old) {
                $this->insertRowIntoHistory($old, 'MIGRATION', 'Migrated from duplicate payroll master row during history split', false, null);
                DB::table('cirt_payroll_master')->where('id', $old->id)->delete();
            }

            DB::table('cirt_payroll_master')->where('id', $keeper->id)->update([
                'effective_to' => null,
                'effective_end_date' => null,
                'status' => $keeper->status ?? 'active',
                'updated_at' => now(),
            ]);
        }
    }

    private function normalizeRemainingCurrentRows(): void
    {
        DB::table('cirt_payroll_master')->orderBy('id')->chunk(200, function ($chunk) {
            foreach ($chunk as $row) {
                $effectiveFrom = $row->effective_from ?? $row->effective_start_date ?? now()->toDateString();
                DB::table('cirt_payroll_master')->where('id', $row->id)->update([
                    'effective_from' => $effectiveFrom,
                    'effective_start_date' => $effectiveFrom,
                    'effective_to' => null,
                    'effective_end_date' => null,
                    'updated_at' => now(),
                ]);
            }
        });
    }

    private function createUniqueCurrentIndexes(): void
    {
        DB::statement('
            CREATE UNIQUE INDEX IF NOT EXISTS ux_cirt_payroll_master_one_current
            ON cirt_payroll_master (company_id, employee_user_id)
            WHERE employee_user_id IS NOT NULL
        ');
        DB::statement('
            CREATE UNIQUE INDEX IF NOT EXISTS ux_cirt_payroll_master_one_current_user
            ON cirt_payroll_master (company_id, user_id)
            WHERE employee_user_id IS NULL AND user_id IS NOT NULL
        ');
    }

    private function createFullHistoryView(): void
    {
        DB::statement('DROP VIEW IF EXISTS cirt_payroll_master_full_history');
        DB::statement("
            CREATE OR REPLACE VIEW cirt_payroll_master_full_history AS
            SELECT
                id AS row_id,
                id AS original_master_id,
                company_id,
                COALESCE(employee_user_id, user_id) AS employee_user_id,
                COALESCE(effective_from, effective_start_date) AS effective_from,
                COALESCE(effective_to, effective_end_date) AS effective_to,
                da_percent,
                hra_percent,
                COALESCE(gross_basic_pay, gross_basic, gross_salary) AS gross_salary,
                take_home,
                reason_for_change AS reason,
                'CURRENT' AS row_type,
                created_at,
                updated_at,
                NULL::timestamptz AS archived_at
            FROM cirt_payroll_master
            UNION ALL
            SELECT
                history_id AS row_id,
                original_master_id,
                company_id,
                COALESCE(employee_user_id, user_id) AS employee_user_id,
                COALESCE(effective_from, effective_start_date) AS effective_from,
                COALESCE(effective_to, effective_end_date) AS effective_to,
                da_percent,
                hra_percent,
                COALESCE(gross_basic_pay, gross_basic, gross_salary) AS gross_salary,
                take_home,
                COALESCE(archive_reason, reason_for_change) AS reason,
                CASE WHEN is_superseded THEN 'SUPERSEDED' ELSE 'HISTORY' END AS row_type,
                created_at,
                updated_at,
                archived_at
            FROM cirt_payroll_master_history
        ");
    }

    private function employeeGroupKey(object $row): string
    {
        $emp = $row->employee_user_id ?? $row->user_id ?? null;
        if ($emp) {
            return (string) $row->company_id.'|uid:'.$emp;
        }
        if (! empty($row->employee_code)) {
            return (string) $row->company_id.'|code:'.$row->employee_code;
        }

        return (string) $row->company_id.'|id:'.$row->id;
    }

    private function compareRowsForCurrent(object $a, object $b): int
    {
        $score = fn (object $r) => (
            ($this->isOpenRow($r) ? 1000 : 0)
            + (($r->status ?? 'active') === 'active' ? 100 : 0)
            + (int) Carbon::parse($r->effective_from ?? $r->effective_start_date ?? '1970-01-01')->timestamp
            + (int) Carbon::parse($r->updated_at ?? $r->created_at ?? '1970-01-01')->timestamp
        );

        return $score($b) <=> $score($a);
    }

    private function isOpenRow(object $row): bool
    {
        return ($row->effective_to ?? null) === null && ($row->effective_end_date ?? null) === null;
    }

    private function insertRowIntoHistory(
        object $row,
        string $archiveAction,
        ?string $archiveReason,
        bool $isSuperseded,
        ?string $replacedByMasterId,
    ): void {
        $attrs = (array) $row;
        $originalId = $attrs['id'];
        unset($attrs['id']);

        $attrs['history_id'] = (string) Str::uuid();
        $attrs['original_master_id'] = $originalId;
        $attrs['archive_action'] = $archiveAction;
        $attrs['archive_reason'] = $archiveReason ?? ($attrs['reason_for_change'] ?? null);
        $attrs['is_superseded'] = $isSuperseded;
        $attrs['archived_at'] = now();
        $attrs['archived_by'] = null;
        $attrs['replaced_by_master_id'] = $replacedByMasterId;

        if (! isset($attrs['effective_from']) && isset($attrs['effective_start_date'])) {
            $attrs['effective_from'] = $attrs['effective_start_date'];
        }

        $columns = array_keys($attrs);
        $placeholders = implode(', ', array_fill(0, count($columns), '?'));
        $columnList = implode(', ', array_map(fn ($c) => '"'.$c.'"', $columns));

        DB::insert(
            "INSERT INTO cirt_payroll_master_history ({$columnList}) VALUES ({$placeholders})",
            array_values($attrs),
        );
    }
};

/*
Verification (must return zero rows after migration):

SELECT company_id, employee_user_id, COUNT(*)
FROM cirt_payroll_master
GROUP BY company_id, employee_user_id
HAVING COUNT(*) > 1;
*/
