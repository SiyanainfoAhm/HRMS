<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class HrmsPayrollPeriod extends Model
{
    use HasUuids;

    protected $table = 'cirt_payroll_periods';
    protected $keyType = 'string';
    public $incrementing = false;

    const UPDATED_AT = null;

    protected $fillable = [
        'company_id', 'period_name', 'period_start', 'period_end',
        'is_locked', 'excel_file_path',
    ];

    protected function casts(): array
    {
        return [
            'period_start' => 'date',
            'period_end' => 'date',
            'is_locked' => 'boolean',
            'created_at' => 'datetime',
        ];
    }

    public function company(): BelongsTo
    {
        return $this->belongsTo(HrmsCompany::class, 'company_id');
    }
}
