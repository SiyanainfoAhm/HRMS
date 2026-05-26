<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class HrmsLeaveType extends Model
{
    use HasUuids;

    protected $table = 'HRMS_leave_types';
    protected $keyType = 'string';
    public $incrementing = false;

    const UPDATED_AT = null;

    protected $fillable = [
        'company_id', 'name', 'code', 'description', 'is_paid', 'annual_quota', 'payslip_slot',
    ];

    protected function casts(): array
    {
        return [
            'is_paid' => 'boolean',
            'annual_quota' => 'decimal:2',
            'created_at' => 'datetime',
        ];
    }

    public function company(): BelongsTo
    {
        return $this->belongsTo(HrmsCompany::class, 'company_id');
    }
}
