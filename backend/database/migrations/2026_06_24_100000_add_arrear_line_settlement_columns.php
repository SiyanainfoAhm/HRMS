<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('cirt_payroll_arrear_lines')) {
            Schema::table('cirt_payroll_arrear_lines', function (Blueprint $table) {
                if (! Schema::hasColumn('cirt_payroll_arrear_lines', 'status')) {
                    $table->string('status', 20)->default('unpaid')->after('is_locked');
                }
                if (! Schema::hasColumn('cirt_payroll_arrear_lines', 'paid_in_payroll_id')) {
                    $table->uuid('paid_in_payroll_id')->nullable()->index()->after('status');
                }
                if (! Schema::hasColumn('cirt_payroll_arrear_lines', 'paid_in_period_id')) {
                    $table->uuid('paid_in_period_id')->nullable()->index()->after('paid_in_payroll_id');
                }
                if (! Schema::hasColumn('cirt_payroll_arrear_lines', 'paid_in_month')) {
                    $table->date('paid_in_month')->nullable()->after('paid_in_period_id');
                }
                if (! Schema::hasColumn('cirt_payroll_arrear_lines', 'paid_at')) {
                    $table->timestampTz('paid_at')->nullable()->after('paid_in_month');
                }
                if (! Schema::hasColumn('cirt_payroll_arrear_lines', 'paid_by')) {
                    $table->uuid('paid_by')->nullable()->after('paid_at');
                }
            });

            $this->backfillPaidArrearLines();
        }

        if (Schema::hasTable('cirt_payroll_arrear_batches')) {
            Schema::table('cirt_payroll_arrear_batches', function (Blueprint $table) {
                if (! Schema::hasColumn('cirt_payroll_arrear_batches', 'paid_at')) {
                    $table->timestampTz('paid_at')->nullable()->after('status');
                }
            });

            DB::statement("
                UPDATE cirt_payroll_arrear_batches
                SET paid_at = updated_at
                WHERE status = 'finalized' AND paid_at IS NULL
            ");
        }
    }

    public function down(): void
    {
        if (Schema::hasTable('cirt_payroll_arrear_lines')) {
            Schema::table('cirt_payroll_arrear_lines', function (Blueprint $table) {
                foreach (['paid_by', 'paid_at', 'paid_in_month', 'paid_in_period_id', 'paid_in_payroll_id', 'status'] as $col) {
                    if (Schema::hasColumn('cirt_payroll_arrear_lines', $col)) {
                        $table->dropColumn($col);
                    }
                }
            });
        }

        if (Schema::hasTable('cirt_payroll_arrear_batches') && Schema::hasColumn('cirt_payroll_arrear_batches', 'paid_at')) {
            Schema::table('cirt_payroll_arrear_batches', function (Blueprint $table) {
                $table->dropColumn('paid_at');
            });
        }
    }

    private function backfillPaidArrearLines(): void
    {
        if (! Schema::hasTable('cirt_payroll_arrear_batches')) {
            return;
        }

        DB::statement("
            UPDATE cirt_payroll_arrear_lines AS l
            SET
                status = 'paid',
                paid_in_period_id = COALESCE(l.paid_in_period_id, l.payroll_period_id, b.payroll_period_id),
                paid_in_month = COALESCE(
                    l.paid_in_month,
                    CASE
                        WHEN b.run_year IS NOT NULL AND b.run_month IS NOT NULL
                        THEN make_date(b.run_year::int, b.run_month::int, 1)
                        ELSE NULL
                    END
                ),
                paid_at = COALESCE(l.paid_at, l.updated_at, b.updated_at)
            FROM cirt_payroll_arrear_batches AS b
            WHERE l.arrear_batch_id = b.id
              AND b.status = 'finalized'
              AND l.is_locked = true
              AND (l.status IS NULL OR l.status = 'unpaid')
        ");

        DB::statement("
            UPDATE cirt_payroll_arrear_lines AS l
            SET paid_in_payroll_id = g.id
            FROM cirt_monthly_payroll AS g
            WHERE l.paid_in_payroll_id IS NULL
              AND l.status = 'paid'
              AND l.paid_in_period_id IS NOT NULL
              AND g.payroll_period_id = l.paid_in_period_id
              AND g.employee_user_id = l.employee_user_id
              AND COALESCE(g.gross_arrear, 0) > 0
        ");
    }
};
