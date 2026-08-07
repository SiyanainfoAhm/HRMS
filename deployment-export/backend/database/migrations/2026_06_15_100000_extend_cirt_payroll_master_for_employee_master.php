<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('cirt_payroll_master')) {
            return;
        }

        Schema::table('cirt_payroll_master', function (Blueprint $table) {
            $add = function (string $col, \Closure $def) {
                if (! Schema::hasColumn('cirt_payroll_master', $col)) {
                    $def();
                }
            };

            $add('employee_id', fn () => $table->uuid('employee_id')->nullable());
            $add('user_id', fn () => $table->uuid('user_id')->nullable());
            $add('employee_code', fn () => $table->string('employee_code')->nullable());
            $add('name', fn () => $table->string('name')->nullable());
            $add('email', fn () => $table->string('email')->nullable());
            $add('phone', fn () => $table->string('phone', 20)->nullable());
            $add('gender', fn () => $table->string('gender', 20)->nullable());
            $add('designation', fn () => $table->string('designation')->nullable());
            $add('department', fn () => $table->string('department')->nullable());
            $add('division', fn () => $table->string('division')->nullable());
            $add('pay_level', fn () => $table->integer('pay_level')->nullable());
            $add('gross_basic_pay', fn () => $table->decimal('gross_basic_pay', 12, 2)->nullable());
            $add('transport_da', fn () => $table->decimal('transport_da', 12, 2)->nullable());
            $add('transport_total', fn () => $table->decimal('transport_total', 12, 2)->nullable());
            $add('total_earnings', fn () => $table->decimal('total_earnings', 12, 2)->nullable());
            $add('cpf_effective', fn () => $table->decimal('cpf_effective', 12, 2)->nullable());
            $add('da_cpf', fn () => $table->decimal('da_cpf', 12, 2)->nullable());
            $add('professional_tax', fn () => $table->decimal('professional_tax', 12, 2)->nullable());
            $add('income_tax', fn () => $table->decimal('income_tax', 12, 2)->nullable());
            $add('lic', fn () => $table->decimal('lic', 12, 2)->nullable());
            $add('mess', fn () => $table->decimal('mess', 12, 2)->nullable());
            $add('welfare', fn () => $table->decimal('welfare', 12, 2)->nullable());
            $add('vpf', fn () => $table->decimal('vpf', 12, 2)->nullable());
            $add('pf_loan', fn () => $table->decimal('pf_loan', 12, 2)->nullable());
            $add('post_office', fn () => $table->decimal('post_office', 12, 2)->nullable());
            $add('credit_society', fn () => $table->decimal('credit_society', 12, 2)->nullable());
            $add('standard_licence_fee', fn () => $table->decimal('standard_licence_fee', 12, 2)->nullable());
            $add('electricity', fn () => $table->decimal('electricity', 12, 2)->nullable());
            $add('water', fn () => $table->decimal('water', 12, 2)->nullable());
            $add('horticulture', fn () => $table->decimal('horticulture', 12, 2)->nullable());
            $add('vehicle_charge', fn () => $table->decimal('vehicle_charge', 12, 2)->nullable());
            $add('other_deduction', fn () => $table->decimal('other_deduction', 12, 2)->nullable());
            $add('advance', fn () => $table->decimal('advance', 12, 2)->nullable());
            $add('uan', fn () => $table->string('uan', 50)->nullable());
            $add('cpf_no', fn () => $table->string('cpf_no', 50)->nullable());
            $add('pan', fn () => $table->string('pan', 20)->nullable());
            $add('aadhaar', fn () => $table->string('aadhaar', 12)->nullable());
            $add('bank_name', fn () => $table->string('bank_name')->nullable());
            $add('bank_account_number', fn () => $table->string('bank_account_number', 50)->nullable());
            $add('bank_ifsc', fn () => $table->string('bank_ifsc', 20)->nullable());
            $add('date_of_joining', fn () => $table->date('date_of_joining')->nullable());
            $add('date_of_birth', fn () => $table->date('date_of_birth')->nullable());
            $add('status', fn () => $table->string('status', 20)->default('active'));
            $add('remarks', fn () => $table->text('remarks')->nullable());
            $add('effective_from', fn () => $table->date('effective_from')->nullable());
            $add('effective_to', fn () => $table->date('effective_to')->nullable());
            $add('updated_at', fn () => $table->timestampTz('updated_at')->nullable());
        });

        if (Schema::hasColumn('cirt_payroll_master', 'employee_user_id')) {
            DB::statement('
                UPDATE cirt_payroll_master
                SET user_id = employee_user_id
                WHERE user_id IS NULL AND employee_user_id IS NOT NULL
            ');
        }

        if (Schema::hasColumn('cirt_payroll_master', 'gross_basic')) {
            DB::statement('
                UPDATE cirt_payroll_master
                SET gross_basic_pay = COALESCE(gross_basic_pay, gross_basic, gross_salary)
                WHERE gross_basic_pay IS NULL
            ');
        }

        if (Schema::hasColumn('cirt_payroll_master', 'effective_start_date')) {
            DB::statement('
                UPDATE cirt_payroll_master
                SET effective_from = COALESCE(effective_from, effective_start_date)
                WHERE effective_from IS NULL
            ');
        }
    }

    public function down(): void
    {
        if (! Schema::hasTable('cirt_payroll_master')) {
            return;
        }

        Schema::table('cirt_payroll_master', function (Blueprint $table) {
            $cols = [
                'employee_id', 'user_id', 'employee_code', 'name', 'email', 'phone', 'gender',
                'designation', 'department', 'division', 'pay_level', 'gross_basic_pay',
                'transport_da', 'transport_total', 'total_earnings', 'cpf_effective', 'da_cpf',
                'professional_tax', 'income_tax', 'lic', 'mess', 'welfare', 'vpf', 'pf_loan',
                'post_office', 'credit_society', 'standard_licence_fee', 'electricity', 'water',
                'horticulture', 'vehicle_charge', 'other_deduction', 'advance',
                'uan', 'cpf_no', 'pan', 'aadhaar', 'bank_name', 'bank_account_number', 'bank_ifsc',
                'date_of_joining', 'date_of_birth', 'status', 'remarks', 'effective_from', 'effective_to', 'updated_at',
            ];
            foreach ($cols as $col) {
                if (Schema::hasColumn('cirt_payroll_master', $col)) {
                    $table->dropColumn($col);
                }
            }
        });
    }
};
