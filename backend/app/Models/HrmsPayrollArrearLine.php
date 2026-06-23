<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class HrmsPayrollArrearLine extends Model
{
    use HasUuids;

    protected $table = 'cirt_payroll_arrear_lines';
    protected $keyType = 'string';
    public $incrementing = false;

    protected $fillable = [
        'arrear_batch_id', 'da_revision_event_id', 'payroll_period_id', 'employee_user_id',
        'arrear_month', 'arrear_year', 'basic', 'transport_base',
        'old_da_percent', 'new_da_percent', 'old_da_amount', 'new_da_amount', 'da_arrear',
        'old_transport_amount', 'new_transport_amount', 'transport_arrear',
        'gross_arrear', 'cpf_rate', 'cpf_arrear', 'net_arrear',
        'source_monthly_payroll_id', 'old_payroll_master_id', 'new_payroll_master_id',
        'is_locked', 'status',
        'paid_in_payroll_id', 'paid_in_period_id', 'paid_in_month', 'paid_at', 'paid_by',
    ];

    protected function casts(): array
    {
        return [
            'basic' => 'float',
            'transport_base' => 'float',
            'old_da_percent' => 'float',
            'new_da_percent' => 'float',
            'old_da_amount' => 'float',
            'new_da_amount' => 'float',
            'da_arrear' => 'float',
            'old_transport_amount' => 'float',
            'new_transport_amount' => 'float',
            'transport_arrear' => 'float',
            'gross_arrear' => 'float',
            'cpf_rate' => 'float',
            'cpf_arrear' => 'float',
            'net_arrear' => 'float',
            'is_locked' => 'boolean',
            'paid_in_month' => 'date',
            'paid_at' => 'datetime',
        ];
    }

    public function isPaid(): bool
    {
        if ($this->status === 'paid') {
            return true;
        }

        return $this->is_locked && $this->batch?->isFinalized();
    }

    public function isUnpaid(): bool
    {
        return ! $this->isPaid() && $this->status !== 'reversed';
    }

    public function batch(): BelongsTo
    {
        return $this->belongsTo(HrmsPayrollArrearBatch::class, 'arrear_batch_id');
    }
}
