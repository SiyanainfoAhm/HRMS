<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class HrmsQuarterAssignment extends Model
{
    use HasUuids;

    protected $table = 'cirt_quarter_assignments';

    protected $keyType = 'string';

    public $incrementing = false;

    protected $fillable = [
        'company_id',
        'quarter_id',
        'employee_id',
        'assigned_from',
        'assigned_to',
        'rent_at_assignment',
        'created_by',
    ];

    protected function casts(): array
    {
        return [
            'assigned_from' => 'date',
            'assigned_to' => 'date',
            'rent_at_assignment' => 'decimal:2',
            'created_at' => 'datetime',
            'updated_at' => 'datetime',
        ];
    }

    public function quarter(): BelongsTo
    {
        return $this->belongsTo(HrmsQuarter::class, 'quarter_id');
    }

    public function employee(): BelongsTo
    {
        return $this->belongsTo(HrmsUser::class, 'employee_id');
    }
}
