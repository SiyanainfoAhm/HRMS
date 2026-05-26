<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class HrmsReimbursement extends Model
{
    use HasUuids;

    protected $table = 'HRMS_reimbursements';
    protected $keyType = 'string';
    public $incrementing = false;

    protected $fillable = [
        'company_id', 'employee_id', 'department_id', 'employee_user_id',
        'category', 'amount', 'currency', 'claim_date', 'description',
        'attachment_url', 'status',
        'approver_id', 'approver_user_id',
        'payroll_year', 'payroll_month', 'rejection_reason',
        'included_in_payroll_period_id',
        'approved_at', 'rejected_at', 'paid_at',
    ];

    protected function casts(): array
    {
        return [
            'amount' => 'decimal:2',
            'claim_date' => 'date',
            'approved_at' => 'datetime',
            'rejected_at' => 'datetime',
            'paid_at' => 'datetime',
            'created_at' => 'datetime',
            'updated_at' => 'datetime',
        ];
    }

    public function company(): BelongsTo { return $this->belongsTo(HrmsCompany::class, 'company_id'); }
    public function employee(): BelongsTo { return $this->belongsTo(HrmsEmployee::class, 'employee_id'); }
    public function employeeUser(): BelongsTo { return $this->belongsTo(HrmsUser::class, 'employee_user_id'); }
    public function approverUser(): BelongsTo { return $this->belongsTo(HrmsUser::class, 'approver_user_id'); }
}
