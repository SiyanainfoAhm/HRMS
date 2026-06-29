<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class HrmsSalaryIncrement extends Model
{
    use HasUuids;

    protected $table = 'cirt_salary_increments';

    protected $keyType = 'string';

    public $incrementing = false;

    protected $fillable = [
        'company_id',
        'employee_id',
        'employee_user_id',
        'employee_code',
        'increment_month',
        'effective_start_date',
        'old_gross_basic',
        'increment_percentage',
        'increment_amount',
        'new_gross_basic',
        'applied_by',
        'applied_at',
        'status',
        'notes',
    ];

    protected function casts(): array
    {
        return [
            'effective_start_date' => 'date',
            'old_gross_basic' => 'decimal:2',
            'increment_percentage' => 'decimal:2',
            'increment_amount' => 'decimal:2',
            'new_gross_basic' => 'decimal:2',
            'applied_at' => 'datetime',
            'created_at' => 'datetime',
            'updated_at' => 'datetime',
        ];
    }

    public function company(): BelongsTo
    {
        return $this->belongsTo(HrmsCompany::class, 'company_id');
    }

    public function employeeUser(): BelongsTo
    {
        return $this->belongsTo(HrmsUser::class, 'employee_user_id');
    }

    public function appliedByUser(): BelongsTo
    {
        return $this->belongsTo(HrmsUser::class, 'applied_by');
    }
}
