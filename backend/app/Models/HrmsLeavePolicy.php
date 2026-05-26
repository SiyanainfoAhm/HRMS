<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class HrmsLeavePolicy extends Model
{
    use HasUuids;

    protected $table = 'HRMS_leave_policies';
    protected $keyType = 'string';
    public $incrementing = false;

    protected $fillable = [
        'company_id', 'leave_type_id', 'accrual_method',
        'monthly_accrual_rate', 'annual_quota', 'prorate_on_join',
        'reset_month', 'reset_day', 'allow_carryover', 'carryover_limit',
    ];

    protected function casts(): array
    {
        return [
            'prorate_on_join' => 'boolean',
            'allow_carryover' => 'boolean',
            'annual_quota' => 'decimal:2',
            'monthly_accrual_rate' => 'decimal:2',
            'carryover_limit' => 'decimal:2',
            'reset_month' => 'integer',
            'reset_day' => 'integer',
            'created_at' => 'datetime',
            'updated_at' => 'datetime',
        ];
    }

    public function company(): BelongsTo
    {
        return $this->belongsTo(HrmsCompany::class, 'company_id');
    }

    public function leaveType(): BelongsTo
    {
        return $this->belongsTo(HrmsLeaveType::class, 'leave_type_id');
    }
}
