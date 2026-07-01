<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class HrmsPayrollMaster extends Model
{
    use HasUuids;

    protected $table = 'cirt_payroll_master';
    protected $keyType = 'string';
    public $incrementing = false;

    protected $fillable = [
        'company_id', 'employee_id', 'user_id', 'employee_user_id',
        'employee_code', 'name', 'email', 'phone', 'gender',
        'designation', 'department', 'division', 'pay_level', 'increment_month',
        'gross_basic_pay', 'gross_salary', 'ctc', 'basic', 'hra', 'medical', 'trans', 'lta', 'personal',
        'pf_eligible', 'esic_eligible',
        'pf_employee', 'pf_employer', 'esic_employee', 'esic_employer',
        'pt', 'take_home', 'tds', 'advance_bonus', 'advance',
        'effective_start_date', 'effective_end_date', 'effective_from', 'effective_to',
        'reason_for_change', 'created_by', 'payroll_mode',
        'gross_basic', 'da_percent', 'da_amount', 'hra_percent', 'medical_fixed',
        'transport_da_percent', 'transport_slab_group', 'transport_base', 'transport_da', 'transport_total',
        'total_earnings', 'income_tax_default', 'income_tax', 'pt_default', 'professional_tax',
        'lic_default', 'lic', 'cpf_default', 'cpf_effective', 'da_cpf_default', 'da_cpf',
        'vpf_default', 'vpf', 'pf_loan_default', 'pf_loan',
        'post_office_default', 'post_office', 'credit_society_default', 'credit_society',
        'std_licence_fee_default', 'standard_licence_fee', 'electricity_default', 'electricity',
        'water_default', 'water', 'mess_default', 'mess',
        'loan_recovery_default', 'loan_recovery', 'welfare_default', 'welfare',
        'veh_charge_default', 'vehicle_charge', 'other_deduction_default', 'other_deduction',
        'cpf_use_company_settings', 'cpf_percentage_override', 'cpf_basis_field_keys_override',
        'uan', 'cpf_no', 'pan', 'aadhaar',
        'bank_name', 'bank_account_number', 'bank_ifsc',
        'date_of_joining', 'date_of_birth', 'status', 'remarks',
        'quarter_id', 'has_quarter', 'quarter_rent',
    ];

    protected function casts(): array
    {
        return [
            'pf_eligible' => 'boolean',
            'esic_eligible' => 'boolean',
            'effective_start_date' => 'date',
            'effective_end_date' => 'date',
            'effective_from' => 'date',
            'effective_to' => 'date',
            'date_of_joining' => 'date',
            'date_of_birth' => 'date',
            'created_at' => 'datetime',
            'updated_at' => 'datetime',
            'cpf_use_company_settings' => 'boolean',
            'cpf_percentage_override' => 'decimal:2',
            'cpf_basis_field_keys_override' => 'array',
            'has_quarter' => 'boolean',
            'quarter_rent' => 'decimal:2',
        ];
    }

    public function company(): BelongsTo { return $this->belongsTo(HrmsCompany::class, 'company_id'); }
    public function employeeUser(): BelongsTo { return $this->belongsTo(HrmsUser::class, 'employee_user_id'); }
    public function user(): BelongsTo { return $this->belongsTo(HrmsUser::class, 'user_id'); }
    public function employee(): BelongsTo { return $this->belongsTo(HrmsEmployee::class, 'employee_id'); }
    public function createdByUser(): BelongsTo { return $this->belongsTo(HrmsUser::class, 'created_by'); }
}
