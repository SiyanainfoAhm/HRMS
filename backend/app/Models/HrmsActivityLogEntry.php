<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

/** One main Activity Log record per action (CIRT-10). */
class HrmsActivityLogEntry extends Model
{
    use HasUuids;

    protected $table = 'cirt_activity_log_entries';
    protected $keyType = 'string';
    public $incrementing = false;
    public $timestamps = false;
    protected $guarded = [];

    protected $casts = ['metadata' => 'array', 'summary' => 'array', 'performed_at' => 'datetime'];

    public function details(): HasMany
    {
        return $this->hasMany(HrmsActivityLogDetail::class, 'entry_id')->orderBy('sort_order');
    }
}
