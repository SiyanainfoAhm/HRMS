<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Run-time leave clarification on monthly payroll snapshot (not Payroll Master).
 */
return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('cirt_monthly_payroll')) {
            return;
        }

        if (! Schema::hasColumn('cirt_monthly_payroll', 'leave_remarks')) {
            Schema::table('cirt_monthly_payroll', function (Blueprint $table) {
                $table->text('leave_remarks')->nullable();
            });
        }
    }

    public function down(): void
    {
        if (! Schema::hasTable('cirt_monthly_payroll')) {
            return;
        }

        if (Schema::hasColumn('cirt_monthly_payroll', 'leave_remarks')) {
            Schema::table('cirt_monthly_payroll', function (Blueprint $table) {
                $table->dropColumn('leave_remarks');
            });
        }
    }
};
