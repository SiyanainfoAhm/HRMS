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
    ];

    protected function casts(): array
    {
        return [
            'created_at' => 'datetime',
            'updated_at' => 'datetime',
        ];
    }

    public function definition(): BelongsTo
    {
        return $this->belongsTo(HrmsPayrollFieldDefinition::class, 'field_definition_id');
    }
}
