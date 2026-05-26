<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class HrmsShift extends Model
{
    use HasUuids;

    protected $table = 'HRMS_shifts';
    protected $keyType = 'string';
    public $incrementing = false;

    const UPDATED_AT = null;

    protected $fillable = [
        'company_id', 'name', 'start_time', 'end_time', 'is_night_shift', 'is_active',
    ];

    protected function casts(): array
    {
        return ['is_night_shift' => 'boolean', 'is_active' => 'boolean', 'created_at' => 'datetime'];
    }

    public function company(): BelongsTo
    {
        return $this->belongsTo(HrmsCompany::class, 'company_id');
    }
}
