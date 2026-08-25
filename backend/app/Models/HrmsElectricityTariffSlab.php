<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class HrmsElectricityTariffSlab extends Model
{
    use HasUuids;

    protected $table = 'cirt_electricity_tariff_slabs';
    protected $keyType = 'string';
    public $incrementing = false;

    protected $guarded = [];

    protected function casts(): array
    {
        return [
            'from_unit' => 'integer',
            'to_unit' => 'integer',
            'rate_per_unit' => 'decimal:4',
            'sort_order' => 'integer',
            'created_at' => 'datetime',
            'updated_at' => 'datetime',
        ];
    }

    public function tariff(): BelongsTo
    {
        return $this->belongsTo(HrmsElectricityTariff::class, 'tariff_id');
    }
}
