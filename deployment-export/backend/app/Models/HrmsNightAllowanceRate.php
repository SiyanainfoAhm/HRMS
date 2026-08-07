<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class HrmsNightAllowanceRate extends Model
{
    use HasUuids;

    protected $table = 'cirt_night_allowance_rates';

    protected $keyType = 'string';

    public $incrementing = false;

    protected $fillable = [
        'company_id',
        'slab_no',
        'pay_level',
        'rate_per_hour',
        'effective_from',
        'is_active',
    ];

    protected function casts(): array
    {
        return [
            'slab_no' => 'integer',
            'pay_level' => 'integer',
            'rate_per_hour' => 'decimal:2',
            'effective_from' => 'date',
            'is_active' => 'boolean',
            'created_at' => 'datetime',
            'updated_at' => 'datetime',
        ];
    }

    public function company(): BelongsTo
    {
        return $this->belongsTo(HrmsCompany::class, 'company_id');
    }
}
