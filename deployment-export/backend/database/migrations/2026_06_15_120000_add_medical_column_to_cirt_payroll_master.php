<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('cirt_payroll_master')) {
            return;
        }

        Schema::table('cirt_payroll_master', function (Blueprint $table) {
            if (! Schema::hasColumn('cirt_payroll_master', 'medical')) {
                $table->decimal('medical', 12, 2)->nullable();
            }
        });
    }

    public function down(): void
    {
        if (! Schema::hasTable('cirt_payroll_master') || ! Schema::hasColumn('cirt_payroll_master', 'medical')) {
            return;
        }

        Schema::table('cirt_payroll_master', function (Blueprint $table) {
            $table->dropColumn('medical');
        });
    }
};
