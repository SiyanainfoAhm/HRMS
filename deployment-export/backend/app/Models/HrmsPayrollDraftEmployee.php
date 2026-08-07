<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class HrmsPayrollDraftEmployee extends Model
{
    use HasUuids;

    protected $table = 'cirt_payroll_draft_employees';

    protected $keyType = 'string';

    public $incrementing = false;

    protected $guarded = [];

    protected $casts = [
        'pay_days' => 'float',
        'gross_pay' => 'float',
        'total_earnings' => 'float',
        'total_deductions' => 'float',
        'total_arrears' => 'float',
        'net_pay' => 'float',
        'row_payload' => 'array',
        'version' => 'integer',
    ];

    public function draft(): BelongsTo
    {
        return $this->belongsTo(HrmsPayrollDraft::class, 'payroll_draft_id');
    }

    public function employeeUser(): BelongsTo
    {
        return $this->belongsTo(HrmsUser::class, 'employee_user_id');
    }
}
