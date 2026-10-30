<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class HrmsActivityLog extends Model
{
    use HasUuids;

    protected $table = 'cirt_activity_logs';
    protected $keyType = 'string';
    public $incrementing = false;
    public const UPDATED_AT = null;
    protected $guarded = [];

    protected $casts = [
        'changed_fields' => 'array',
        'previous_value' => 'array',
        'new_value' => 'array',
        'metadata' => 'array',
        'created_at' => 'datetime',
    ];

    public function actor(): BelongsTo
    {
        return $this->belongsTo(HrmsUser::class, 'actor_user_id');
    }

    public function targetEmployee(): BelongsTo
    {
        return $this->belongsTo(HrmsUser::class, 'target_employee_user_id');
    }
}
