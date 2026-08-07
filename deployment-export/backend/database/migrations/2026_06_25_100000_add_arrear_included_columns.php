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
            if (! Schema::hasColumn('cirt_payroll_arrear_lines', 'company_id')) {
                $table->uuid('company_id')->nullable()->index()->after('id');
            }
            if (! Schema::hasColumn('cirt_payroll_arrear_lines', 'included_in_payroll_period_id')) {
                $table->uuid('included_in_payroll_period_id')->nullable()->index()->after('paid_by');
            }
            if (! Schema::hasColumn('cirt_payroll_arrear_lines', 'included_in_month')) {
                $table->unsignedSmallInteger('included_in_month')->nullable()->after('included_in_payroll_period_id');
            }
            if (! Schema::hasColumn('cirt_payroll_arrear_lines', 'included_in_year')) {
                $table->unsignedSmallInteger('included_in_year')->nullable()->after('included_in_month');
            }
            if (! Schema::hasColumn('cirt_payroll_arrear_lines', 'included_in_payroll_id')) {
                $table->uuid('included_in_payroll_id')->nullable()->index()->after('included_in_year');
            }
        });

        DB::statement("
            UPDATE cirt_payroll_arrear_lines AS l
            SET company_id = b.company_id
            FROM cirt_payroll_arrear_batches AS b
            WHERE l.arrear_batch_id = b.id
              AND l.company_id IS NULL
        ");

        DB::statement("
            UPDATE cirt_payroll_arrear_lines
            SET
                status = UPPER(COALESCE(status, 'UNPAID')),
                included_in_payroll_period_id = COALESCE(included_in_payroll_period_id, paid_in_period_id),
                included_in_payroll_id = COALESCE(included_in_payroll_id, paid_in_payroll_id),
                included_in_month = COALESCE(
                    included_in_month,
                    EXTRACT(MONTH FROM paid_in_month)::int,
                    EXTRACT(MONTH FROM paid_at)::int
                ),
                included_in_year = COALESCE(
                    included_in_year,
                    EXTRACT(YEAR FROM paid_in_month)::int,
                    EXTRACT(YEAR FROM paid_at)::int
                )
            WHERE UPPER(COALESCE(status, '')) = 'PAID'
               OR paid_at IS NOT NULL
               OR is_locked = true
        ");

        DB::statement("
            UPDATE cirt_payroll_arrear_lines
            SET status = 'UNPAID'
            WHERE status IS NULL OR UPPER(status) NOT IN ('PAID', 'INCLUDED', 'DRAFT', 'CANCELLED')
        ");
    }

    public function down(): void
    {
        if (! Schema::hasTable('cirt_payroll_arrear_lines')) {
            return;
        }

        Schema::table('cirt_payroll_arrear_lines', function (Blueprint $table) {
            foreach ([
                'included_in_payroll_id',
                'included_in_year',
                'included_in_month',
                'included_in_payroll_period_id',
                'company_id',
            ] as $col) {
                if (Schema::hasColumn('cirt_payroll_arrear_lines', $col)) {
                    $table->dropColumn($col);
                }
            }
        });
    }
};
