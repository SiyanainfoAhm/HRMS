<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class HrmsPayrollMasterHistory extends Model
{
    use HasUuids;

    protected $table = 'cirt_payroll_master_history';
    protected $primaryKey = 'history_id';
    protected $keyType = 'string';
    public $incrementing = false;

    protected $fillable = [
        'history_id', 'original_master_id', 'company_id', 'employee_id', 'user_id', 'employee_user_id',
        'employee_code', 'name', 'email', 'phone', 'gender',
        'designation', 'department', 'division', 'pay_level',
        'gross_basic_pay', 'gross_salary', 'ctc', 'basic', 'hra', 'medical', 'trans', 'lta', 'personal',
        'pf_eligible', 'esic_eligible',
        'pf_employee', 'pf_employer', 'esic_employee', 'esic_employer',
        'pt', 'take_home', 'tds', 'advance_bonus', 'advance',
        'effective_start_date', 'effective_end_date', 'effective_from', 'effective_to',
        'reason_for_change', 'created_by', 'payroll_mode',
        'gross_basic', 'da_percent', 'hra_percent', 'medical_fixed',
        'transport_da_percent', 'transport_slab_group', 'transport_base', 'transport_da', 'transport_total',
        'total_earnings', 'income_tax_default', 'income_tax', 'pt_default', 'professional_tax',
        'lic_default', 'lic', 'cpf_default', 'cpf_effective', 'da_cpf_default', 'da_cpf',
        'vpf_default', 'vpf', 'pf_loan_default', 'pf_loan',
        'post_office_default', 'post_office', 'credit_society_default', 'credit_society',
        'std_licence_fee_default', 'standard_licence_fee', 'electricity_default', 'electricity',
        'water_default', 'water', 'mess_default', 'mess',
        'horticulture_default', 'horticulture', 'welfare_default', 'welfare',
        'veh_charge_default', 'vehicle_charge', 'other_deduction_default', 'other_deduction',
        'uan', 'cpf_no', 'pan', 'aadhaar',
        'bank_name', 'bank_account_number', 'bank_ifsc',
        'date_of_joining', 'date_of_birth', 'status', 'remarks',
        'archive_action', 'archive_reason', 'is_superseded', 'archived_at', 'archived_by', 'replaced_by_master_id',
    ];

    protected function casts(): array
    {
        return [
            'pf_eligible' => 'boolean',
            'esic_eligible' => 'boolean',
            'is_superseded' => 'boolean',
            'effective_start_date' => 'date',
            'effective_end_date' => 'date',
            'effective_from' => 'date',
            'effective_to' => 'date',
            'date_of_joining' => 'date',
            'date_of_birth' => 'date',
            'archived_at' => 'datetime',
            'created_at' => 'datetime',
            'updated_at' => 'datetime',
        ];
    }

    public function company(): BelongsTo { return $this->belongsTo(HrmsCompany::class, 'company_id'); }
    public function employeeUser(): BelongsTo { return $this->belongsTo(HrmsUser::class, 'employee_user_id'); }
}
