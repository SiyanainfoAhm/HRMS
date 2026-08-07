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
            if (! Schema::hasColumn('cirt_payroll_master', 'cpf_use_company_settings')) {
                $table->boolean('cpf_use_company_settings')->default(true);
            }
            if (! Schema::hasColumn('cirt_payroll_master', 'cpf_percentage_override')) {
                $table->decimal('cpf_percentage_override', 8, 2)->nullable();
            }
            if (! Schema::hasColumn('cirt_payroll_master', 'cpf_basis_field_keys_override')) {
                $table->json('cpf_basis_field_keys_override')->nullable();
            }
        });
    }

    public function down(): void
    {
        if (! Schema::hasTable('cirt_payroll_master')) {
            return;
        }

        Schema::table('cirt_payroll_master', function (Blueprint $table) {
            foreach (['cpf_use_company_settings', 'cpf_percentage_override', 'cpf_basis_field_keys_override'] as $col) {
                if (Schema::hasColumn('cirt_payroll_master', $col)) {
                    $table->dropColumn($col);
                }
            }
        });
    }
};
