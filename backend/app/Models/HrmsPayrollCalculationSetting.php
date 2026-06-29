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
    ];

    protected function casts(): array
    {
        return [
            'cpf_percentage' => 'decimal:2',
            'cpf_basis_field_keys' => 'array',
            'created_at' => 'datetime',
            'updated_at' => 'datetime',
        ];
    }

    public function company(): BelongsTo
    {
        return $this->belongsTo(HrmsCompany::class, 'company_id');
    }
}
