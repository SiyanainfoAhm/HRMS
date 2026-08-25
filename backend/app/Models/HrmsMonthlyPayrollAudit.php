<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class HrmsMonthlyPayrollAudit extends Model
{
    use HasUuids;

    protected $table = 'cirt_monthly_payroll_audits';
    protected $keyType = 'string';
    public $incrementing = false;

    const UPDATED_AT = null;

    protected $guarded = [];

    protected $casts = [
        'before_payload' => 'array',
        'after_payload' => 'array',
        'changed_fields' => 'array',
        'created_at' => 'datetime',
    ];

    public function monthlyPayroll(): BelongsTo
    {
        return $this->belongsTo(HrmsGovernmentMonthlyPayroll::class, 'monthly_payroll_id');
    }

    public function payrollPeriod(): BelongsTo
    {
        return $this->belongsTo(HrmsPayrollPeriod::class, 'payroll_period_id');
    }

    public function employeeUser(): BelongsTo
    {
        return $this->belongsTo(HrmsUser::class, 'employee_user_id');
    }

    public function changedByUser(): BelongsTo
    {
        return $this->belongsTo(HrmsUser::class, 'changed_by');
    }
}
