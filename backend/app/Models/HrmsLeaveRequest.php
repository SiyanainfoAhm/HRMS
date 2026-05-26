<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class HrmsLeaveRequest extends Model
{
    use HasUuids;

    protected $table = 'HRMS_leave_requests';
    protected $keyType = 'string';
    public $incrementing = false;

    protected $fillable = [
        'company_id', 'employee_id', 'employee_user_id', 'manager_id',
        'department_id', 'leave_type_id', 'start_date', 'end_date',
        'total_days', 'reason', 'status',
        'approver_id', 'approver_user_id', 'approved_at', 'rejected_at',
        'rejection_reason', 'paid_days', 'unpaid_days',
    ];

    protected function casts(): array
    {
        return [
            'start_date' => 'date',
            'end_date' => 'date',
            'total_days' => 'decimal:2',
            'paid_days' => 'decimal:2',
            'unpaid_days' => 'decimal:2',
            'approved_at' => 'datetime',
            'rejected_at' => 'datetime',
            'created_at' => 'datetime',
            'updated_at' => 'datetime',
        ];
    }

    public function company(): BelongsTo { return $this->belongsTo(HrmsCompany::class, 'company_id'); }
    public function employee(): BelongsTo { return $this->belongsTo(HrmsEmployee::class, 'employee_id'); }
    public function employeeUser(): BelongsTo { return $this->belongsTo(HrmsUser::class, 'employee_user_id'); }
    public function leaveType(): BelongsTo { return $this->belongsTo(HrmsLeaveType::class, 'leave_type_id'); }
    public function approverUser(): BelongsTo { return $this->belongsTo(HrmsUser::class, 'approver_user_id'); }
}
