<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('cirt_monthly_payroll')) {
            Schema::table('cirt_monthly_payroll', function (Blueprint $table) {
                if (! Schema::hasColumn('cirt_monthly_payroll', 'hpl_days')) {
                    $table->unsignedSmallInteger('hpl_days')->nullable()->after('hpl_amount');
                }
                if (! Schema::hasColumn('cirt_monthly_payroll', 'eol_days')) {
                    $table->unsignedSmallInteger('eol_days')->nullable()->after('eol_amount');
                }
            });
        }
    }

    public function down(): void
    {
        if (Schema::hasTable('cirt_monthly_payroll')) {
            Schema::table('cirt_monthly_payroll', function (Blueprint $table) {
                foreach (['hpl_days', 'eol_days'] as $col) {
                    if (Schema::hasColumn('cirt_monthly_payroll', $col)) {
                        $table->dropColumn($col);
                    }
                }
            });
        }
    }
};
