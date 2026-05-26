<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class HrmsHoliday extends Model
{
    use HasUuids;

    protected $table = 'HRMS_holidays';
    protected $keyType = 'string';
    public $incrementing = false;

    const UPDATED_AT = null;

    protected $fillable = [
        'company_id', 'name', 'holiday_date', 'holiday_end_date',
        'is_optional', 'location',
    ];

    protected function casts(): array
    {
        return [
            'holiday_date' => 'date',
            'holiday_end_date' => 'date',
            'is_optional' => 'boolean',
            'created_at' => 'datetime',
        ];
    }

    public function company(): BelongsTo
    {
        return $this->belongsTo(HrmsCompany::class, 'company_id');
    }
}
