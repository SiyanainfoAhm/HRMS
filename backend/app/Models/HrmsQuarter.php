<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class HrmsQuarter extends Model
{
    use HasUuids;

    protected $table = 'cirt_quarters';

    protected $keyType = 'string';

    public $incrementing = false;

    protected $fillable = [
        'company_id',
        'quarter_name',
        'quarter_type',
        'monthly_rent',
        'status',
        'assigned_employee_id',
        'assigned_from',
        'assigned_to',
        'created_by',
    ];

    protected function casts(): array
    {
        return [
            'monthly_rent' => 'decimal:2',
            'assigned_from' => 'date',
            'assigned_to' => 'date',
            'created_at' => 'datetime',
            'updated_at' => 'datetime',
        ];
    }

    public function company(): BelongsTo
    {
        return $this->belongsTo(HrmsCompany::class, 'company_id');
    }

    public function assignedEmployee(): BelongsTo
    {
        return $this->belongsTo(HrmsUser::class, 'assigned_employee_id');
    }
}
