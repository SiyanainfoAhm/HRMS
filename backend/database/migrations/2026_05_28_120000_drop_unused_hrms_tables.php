<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Run only after backup and after confirming no code references remain.
 *
 * Drops HRMS module tables that are outside CIRT Payroll scope.
 * Irreversible without a database backup — down() does not recreate schemas.
 */
return new class extends Migration
{
    /** @var list<string> Physical table names (HRMS_* or old_HRMS_* after archive migration). */
    private array $tables = [
        'HRMS_attendance_logs',
        'old_HRMS_attendance_logs',
        'HRMS_company_documents',
        'old_HRMS_company_documents',
        'HRMS_employee_document_submissions',
        'old_HRMS_employee_document_submissions',
        'HRMS_employee_invites',
        'old_HRMS_employee_invites',
        'HRMS_holidays',
        'old_HRMS_holidays',
        'HRMS_leave_policies',
        'old_HRMS_leave_policies',
        'HRMS_leave_requests',
        'old_HRMS_leave_requests',
        'HRMS_leave_types',
        'old_HRMS_leave_types',
        'HRMS_notifications',
        'old_HRMS_notifications',
        'HRMS_reimbursements',
        'old_HRMS_reimbursements',
        'HRMS_shifts',
        'old_HRMS_shifts',
    ];

    public function up(): void
    {
        foreach ($this->tables as $table) {
            $this->dropTableIfExists($table);
        }
    }

    public function down(): void
    {
        // Irreversible without backup — original create migrations are not replayed here.
    }

    private function dropTableIfExists(string $table): void
    {
        if (! $this->tableExists($table)) {
            return;
        }

        if ($this->needsQuotedIdentifier($table)) {
            DB::statement(sprintf('DROP TABLE IF EXISTS public."%s" CASCADE', str_replace('"', '', $table)));

            return;
        }

        Schema::dropIfExists($table);
    }

    private function tableExists(string $name): bool
    {
        if (Schema::hasTable($name)) {
            return true;
        }

        $row = DB::selectOne(
            'SELECT EXISTS (
                SELECT 1 FROM information_schema.tables
                WHERE table_schema = ? AND table_name = ?
            ) AS "exists"',
            ['public', $name]
        );

        return (bool) ($row->exists ?? false);
    }

    private function needsQuotedIdentifier(string $name): bool
    {
        return str_contains($name, 'HRMS_') || str_contains($name, 'old_HRMS_');
    }
};
