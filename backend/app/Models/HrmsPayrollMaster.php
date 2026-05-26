<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class HrmsPayrollMaster extends Model
{
    use HasUuids;

    protected $table = 'HRMS_payroll_master';
    protected $keyType = 'string';
    public $incrementing = false;

    const UPDATED_AT = null;

    protected $fillable = [
        'company_id', 'employee_user_id',
        'gross_salary', 'ctc', 'basic', 'hra', 'medical', 'trans', 'lta', 'personal',
        'pf_eligible', 'esic_eligible',
        'pf_employee', 'pf_employer', 'esic_employee', 'esic_employer',
        'pt', 'take_home', 'tds', 'advance_bonus',
        'effective_start_date', 'effective_end_date', 'reason_for_change',
        'created_by', 'payroll_mode',
        'gross_basic', 'da_percent', 'hra_percent', 'medical_fixed',
        'transport_da_percent', 'transport_slab_group', 'transport_base',
        'income_tax_default', 'pt_default', 'lic_default',
        'cpf_default', 'da_cpf_default', 'vpf_default', 'pf_loan_default',
        'post_office_default', 'credit_society_default', 'std_licence_fee_default',
        'electricity_default', 'water_default', 'mess_default',
        'horticulture_default', 'welfare_default', 'veh_charge_default',
        'other_deduction_default',
    ];

    protected function casts(): array
    {
        return [
            'pf_eligible' => 'boolean',
            'esic_eligible' => 'boolean',
            'effective_start_date' => 'date',
            'effective_end_date' => 'date',
            'created_at' => 'datetime',
        ];
    }

    public function company(): BelongsTo { return $this->belongsTo(HrmsCompany::class, 'company_id'); }
    public function employeeUser(): BelongsTo { return $this->belongsTo(HrmsUser::class, 'employee_user_id'); }
    public function createdByUser(): BelongsTo { return $this->belongsTo(HrmsUser::class, 'created_by'); }
}
