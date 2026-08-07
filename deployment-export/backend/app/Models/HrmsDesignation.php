<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class HrmsDesignation extends Model
{
    use HasUuids;

    protected $table = 'cirt_designations';
    protected $keyType = 'string';
    public $incrementing = false;

    const UPDATED_AT = null;

    protected $fillable = [
        'company_id', 'title', 'level', 'is_active',
    ];

    protected function casts(): array
    {
        return ['is_active' => 'boolean', 'level' => 'integer', 'created_at' => 'datetime'];
    }

    public function company(): BelongsTo
    {
        return $this->belongsTo(HrmsCompany::class, 'company_id');
    }
}
