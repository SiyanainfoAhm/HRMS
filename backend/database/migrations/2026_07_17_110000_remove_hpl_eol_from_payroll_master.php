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
                foreach (['hpl_default', 'hpl', 'eol_default', 'eol'] as $col) {
                    if (Schema::hasColumn('cirt_payroll_master', $col)) {
                        $table->dropColumn($col);
                    }
                }
            });
        }
    }

    public function down(): void
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
    }
};
