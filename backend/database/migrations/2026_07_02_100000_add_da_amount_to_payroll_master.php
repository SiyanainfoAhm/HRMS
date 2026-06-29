<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('cirt_payroll_master') && ! Schema::hasColumn('cirt_payroll_master', 'da_amount')) {
            Schema::table('cirt_payroll_master', function (Blueprint $table) {
                $table->decimal('da_amount', 12, 2)->nullable()->after('da_percent');
            });

            if (Schema::hasColumn('cirt_payroll_master', 'gross_basic_pay') && Schema::hasColumn('cirt_payroll_master', 'da_percent')) {
                DB::statement('
                    UPDATE cirt_payroll_master
                    SET da_amount = ROUND(COALESCE(gross_basic_pay, gross_basic, gross_salary, 0) * COALESCE(da_percent, 53) / 100, 0)
                    WHERE da_amount IS NULL
                ');
            }
        }

        if (Schema::hasTable('cirt_payroll_master_history') && ! Schema::hasColumn('cirt_payroll_master_history', 'da_amount')) {
            Schema::table('cirt_payroll_master_history', function (Blueprint $table) {
                $table->decimal('da_amount', 12, 2)->nullable()->after('da_percent');
            });
        }
    }

    public function down(): void
    {
        if (Schema::hasTable('cirt_payroll_master') && Schema::hasColumn('cirt_payroll_master', 'da_amount')) {
            Schema::table('cirt_payroll_master', function (Blueprint $table) {
                $table->dropColumn('da_amount');
            });
        }

        if (Schema::hasTable('cirt_payroll_master_history') && Schema::hasColumn('cirt_payroll_master_history', 'da_amount')) {
            Schema::table('cirt_payroll_master_history', function (Blueprint $table) {
                $table->dropColumn('da_amount');
            });
        }
    }
};
