<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class HrmsPayrollFieldDefinition extends Model
{
    use HasUuids;

    protected $table = 'cirt_payroll_field_definitions';

    protected $keyType = 'string';

    public $incrementing = false;

    protected $fillable = [
        'company_id',
        'field_label',
        'field_key',
        'field_group',
        'field_type',
        'calculation_type',
        'default_value',
        'dropdown_options',
        'is_required',
        'show_in_payroll_master',
        'show_in_run_payroll',
        'show_in_salary_slip',
        'include_in_total_earnings',
        'include_in_total_deductions',
        'is_system',
        'is_active',
        'display_order',
        'created_by',
    ];

    protected function casts(): array
    {
        return [
            'dropdown_options' => 'array',
            'is_required' => 'boolean',
            'show_in_payroll_master' => 'boolean',
            'show_in_run_payroll' => 'boolean',
            'show_in_salary_slip' => 'boolean',
            'include_in_total_earnings' => 'boolean',
            'include_in_total_deductions' => 'boolean',
            'is_system' => 'boolean',
            'is_active' => 'boolean',
            'display_order' => 'integer',
            'created_at' => 'datetime',
            'updated_at' => 'datetime',
        ];
    }

    public function company(): BelongsTo
    {
        return $this->belongsTo(HrmsCompany::class, 'company_id');
    }

    public function values(): HasMany
    {
        return $this->hasMany(HrmsPayrollFieldValue::class, 'field_definition_id');
    }
}
