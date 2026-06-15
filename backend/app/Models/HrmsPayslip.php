<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class HrmsPayslip extends Model
{
    use HasUuids;

    protected $table = 'cirt_payslips';
    protected $keyType = 'string';
    public $incrementing = false;
    public $timestamps = false;

    protected $fillable = [
        'company_id', 'employee_id', 'employee_user_id', 'payroll_period_id',
        'basic', 'hra', 'allowances', 'deductions', 'gross_pay', 'net_pay',
        'currency', 'payslip_number',
        'bank_name', 'bank_account_number', 'bank_ifsc',
        'pay_days', 'ctc',
        'pf_employee', 'pf_employer', 'esic_employee', 'esic_employer',
        'professional_tax', 'incentive', 'pr_bonus', 'reimbursement', 'tds',
        'medical', 'trans', 'lta', 'personal',
        'generated_at', 'created_by', 'payroll_mode',
    ];

    protected function casts(): array
    {
        return [
            'generated_at' => 'datetime',
        ];
    }

    public function company(): BelongsTo { return $this->belongsTo(HrmsCompany::class, 'company_id'); }
    public function employee(): BelongsTo { return $this->belongsTo(HrmsEmployee::class, 'employee_id'); }
    public function employeeUser(): BelongsTo { return $this->belongsTo(HrmsUser::class, 'employee_user_id'); }
    public function payrollPeriod(): BelongsTo { return $this->belongsTo(HrmsPayrollPeriod::class, 'payroll_period_id'); }
}
