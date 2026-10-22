<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class HrmsPayrollFieldValue extends Model
{
    use HasUuids;

    protected $table = 'cirt_payroll_field_values';

    protected $keyType = 'string';

    public $incrementing = false;

    protected $fillable = [
        'company_id',
        'employee_id',
        'payroll_master_id',
        'payroll_period_id',
        'field_definition_id',
        'field_key',
        'field_value',
        'effective_from',
        'effective_to',
        'recurrence',
        'source_reference',
    ];

    protected function casts(): array
    {
        return [
            'created_at' => 'datetime',
            'updated_at' => 'datetime',
            'effective_from' => 'date',
            'effective_to' => 'date',
        ];
    }

    public function definition(): BelongsTo
    {
        return $this->belongsTo(HrmsPayrollFieldDefinition::class, 'field_definition_id');
    }
}
