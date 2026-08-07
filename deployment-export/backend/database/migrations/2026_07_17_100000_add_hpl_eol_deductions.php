<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('cirt_payroll_master')) {
            Schema::table('cirt_payroll_master', function (Blueprint $table) {
                if (! Schema::hasColumn('cirt_payroll_master', 'hpl_default')) {
                    $table->decimal('hpl_default', 12, 2)->default(0);
                }
                if (! Schema::hasColumn('cirt_payroll_master', 'hpl')) {
                    $table->decimal('hpl', 12, 2)->default(0);
                }
                if (! Schema::hasColumn('cirt_payroll_master', 'eol_default')) {
                    $table->decimal('eol_default', 12, 2)->default(0);
                }
                if (! Schema::hasColumn('cirt_payroll_master', 'eol')) {
                    $table->decimal('eol', 12, 2)->default(0);
                }
            });
        }

        if (Schema::hasTable('cirt_monthly_payroll')) {
            Schema::table('cirt_monthly_payroll', function (Blueprint $table) {
                if (! Schema::hasColumn('cirt_monthly_payroll', 'hpl_amount')) {
                    $table->decimal('hpl_amount', 12, 2)->nullable();
                }
                if (! Schema::hasColumn('cirt_monthly_payroll', 'eol_amount')) {
                    $table->decimal('eol_amount', 12, 2)->nullable();
                }
            });
        }
    }

    public function down(): void
    {
        // Non-destructive: columns retained for payroll history.
    }
};
