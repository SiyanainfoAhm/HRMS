<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('cirt_payroll_arrear_lines')) {
            return;
        }

        Schema::table('cirt_payroll_arrear_lines', function (Blueprint $table) {
            if (! Schema::hasColumn('cirt_payroll_arrear_lines', 'da_revision_event_id')) {
                $table->uuid('da_revision_event_id')->nullable()->index();
            }
        });

        if (Schema::hasTable('cirt_payroll_arrear_batches')) {
            DB::statement('
                UPDATE cirt_payroll_arrear_lines AS l
                SET da_revision_event_id = b.da_revision_event_id
                FROM cirt_payroll_arrear_batches AS b
                WHERE l.arrear_batch_id = b.id
                  AND l.da_revision_event_id IS NULL
            ');
        }

        $this->removeDuplicateArrearLines();

        Schema::table('cirt_payroll_arrear_lines', function (Blueprint $table) {
            if (! $this->indexExists('cirt_payroll_arrear_lines', 'cirt_arrear_line_emp_month_rev_uniq')) {
                $table->unique(
                    ['employee_user_id', 'arrear_year', 'arrear_month', 'da_revision_event_id'],
                    'cirt_arrear_line_emp_month_rev_uniq',
                );
            }
        });
    }

    public function down(): void
    {
        if (! Schema::hasTable('cirt_payroll_arrear_lines')) {
            return;
        }

        Schema::table('cirt_payroll_arrear_lines', function (Blueprint $table) {
            if ($this->indexExists('cirt_payroll_arrear_lines', 'cirt_arrear_line_emp_month_rev_uniq')) {
                $table->dropUnique('cirt_arrear_line_emp_month_rev_uniq');
            }
            if (Schema::hasColumn('cirt_payroll_arrear_lines', 'da_revision_event_id')) {
                $table->dropColumn('da_revision_event_id');
            }
        });
    }

    private function removeDuplicateArrearLines(): void
    {
        DB::statement('
            DELETE FROM cirt_payroll_arrear_lines AS dup
            USING cirt_payroll_arrear_lines AS keep
            WHERE dup.id <> keep.id
              AND dup.employee_user_id = keep.employee_user_id
              AND dup.arrear_year = keep.arrear_year
              AND dup.arrear_month = keep.arrear_month
              AND dup.old_da_percent = keep.old_da_percent
              AND dup.new_da_percent = keep.new_da_percent
              AND dup.is_locked = false
              AND keep.is_locked = false
              AND dup.created_at < keep.created_at
        ');
    }

    private function indexExists(string $table, string $index): bool
    {
        $row = DB::selectOne(
            'SELECT 1 FROM pg_indexes WHERE tablename = ? AND indexname = ?',
            [$table, $index],
        );

        return $row !== null;
    }
};
