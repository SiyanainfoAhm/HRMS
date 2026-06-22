<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class HrmsPayrollArrearBatch extends Model
{
    use HasUuids;

    protected $table = 'cirt_payroll_arrear_batches';
    protected $keyType = 'string';
    public $incrementing = false;

    protected $fillable = [
        'company_id', 'payroll_period_id', 'da_revision_event_id',
        'run_month', 'run_year', 'arrear_from', 'arrear_to', 'status',
        'total_da_arrear', 'total_transport_arrear', 'total_gross_arrear',
        'total_cpf_arrear', 'total_net_arrear',
    ];

    protected function casts(): array
    {
        return [
            'arrear_from' => 'date',
            'arrear_to' => 'date',
            'total_da_arrear' => 'float',
            'total_transport_arrear' => 'float',
            'total_gross_arrear' => 'float',
            'total_cpf_arrear' => 'float',
            'total_net_arrear' => 'float',
        ];
    }

    public function revisionEvent(): BelongsTo
    {
        return $this->belongsTo(HrmsDaRevisionEvent::class, 'da_revision_event_id');
    }

    public function payrollPeriod(): BelongsTo
    {
        return $this->belongsTo(HrmsPayrollPeriod::class, 'payroll_period_id');
    }

    public function lines(): HasMany
    {
        return $this->hasMany(HrmsPayrollArrearLine::class, 'arrear_batch_id');
    }

    public function isFinalized(): bool
    {
        return $this->status === 'finalized';
    }
}
