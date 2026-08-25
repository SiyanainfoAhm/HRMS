<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class HrmsElectricityTariff extends Model
{
    use HasUuids;

    protected $table = 'cirt_electricity_tariffs';
    protected $keyType = 'string';
    public $incrementing = false;

    protected $guarded = [];

    protected function casts(): array
    {
        return [
            'effective_from' => 'date',
            'sthir_aakar' => 'decimal:2',
            'vahan_aakar_per_unit' => 'decimal:4',
            'fuel_charge' => 'decimal:2',
            'duty_percentage' => 'decimal:4',
            'is_active' => 'boolean',
            'created_at' => 'datetime',
            'updated_at' => 'datetime',
        ];
    }

    public function company(): BelongsTo
    {
        return $this->belongsTo(HrmsCompany::class, 'company_id');
    }

    public function slabs(): HasMany
    {
        return $this->hasMany(HrmsElectricityTariffSlab::class, 'tariff_id')->orderBy('sort_order');
    }
}
