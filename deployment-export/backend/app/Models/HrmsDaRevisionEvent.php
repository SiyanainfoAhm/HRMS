<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class HrmsDaRevisionEvent extends Model
{
    use HasUuids;

    protected $table = 'cirt_da_revision_events';
    protected $keyType = 'string';
    public $incrementing = false;

    protected $fillable = [
        'company_id', 'old_da_percent', 'new_da_percent', 'effective_from',
        'revision_reason', 'created_by',
    ];

    protected function casts(): array
    {
        return [
            'effective_from' => 'date',
            'old_da_percent' => 'float',
            'new_da_percent' => 'float',
        ];
    }

    public function batches(): HasMany
    {
        return $this->hasMany(HrmsPayrollArrearBatch::class, 'da_revision_event_id');
    }
}
