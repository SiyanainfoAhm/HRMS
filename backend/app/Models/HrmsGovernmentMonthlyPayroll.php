<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class HrmsGovernmentMonthlyPayroll extends Model
{
    use HasUuids;

    protected $table = 'cirt_monthly_payroll';
    protected $keyType = 'string';
    public $incrementing = false;

    const UPDATED_AT = null;

    protected $guarded = [];

    protected $casts = [
        'custom_earnings' => 'array',
        'custom_deductions' => 'array',
    ];

    public function payslip(): BelongsTo
    {
        return $this->belongsTo(HrmsPayslip::class, 'payslip_id');
    }

    public function payrollPeriod(): BelongsTo
    {
        return $this->belongsTo(HrmsPayrollPeriod::class, 'payroll_period_id');
    }
}
