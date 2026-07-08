<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class HrmsPayrollCalculationSetting extends Model
{
    use HasUuids;

    protected $table = 'cirt_payroll_calculation_settings';

    protected $keyType = 'string';

    public $incrementing = false;

    protected $fillable = [
        'company_id',
        'cpf_percentage',
        'cpf_basis_field_keys',
        'cpf_calculation_mode',
        'cpf_fixed_amount',
        'electricity_unit_rate',
        'night_allowance_basic_ceiling',
    ];

    protected function casts(): array
    {
        return [
            'cpf_percentage' => 'decimal:2',
            'cpf_basis_field_keys' => 'array',
            'cpf_fixed_amount' => 'decimal:2',
            'electricity_unit_rate' => 'decimal:2',
            'night_allowance_basic_ceiling' => 'decimal:2',
            'created_at' => 'datetime',
            'updated_at' => 'datetime',
        ];
    }

    public function company(): BelongsTo
    {
        return $this->belongsTo(HrmsCompany::class, 'company_id');
    }
}
