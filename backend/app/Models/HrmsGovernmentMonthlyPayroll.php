<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class HrmsGovernmentMonthlyPayroll extends Model
{
    use HasUuids;

    protected $table = 'HRMS_government_monthly_payroll';
    protected $keyType = 'string';
    public $incrementing = false;

    const UPDATED_AT = null;

    protected $guarded = [];

    public function payslip(): BelongsTo
    {
        return $this->belongsTo(HrmsPayslip::class, 'payslip_id');
    }

    public function payrollPeriod(): BelongsTo
    {
        return $this->belongsTo(HrmsPayrollPeriod::class, 'payroll_period_id');
    }
}
