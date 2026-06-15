<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class HrmsEmployee extends Model
{
    use HasUuids;

    protected $table = 'cirt_employees';
    protected $keyType = 'string';
    public $incrementing = false;

    protected $fillable = [
        'user_id', 'company_id', 'employee_code',
        'first_name', 'last_name', 'email', 'phone',
        'date_of_birth', 'date_of_joining', 'date_of_leaving',
        'division_id', 'department_id', 'designation_id', 'shift_id',
        'manager_id', 'role_id', 'is_active',
        'address_line1', 'address_line2', 'city', 'state', 'country', 'postal_code',
        'emergency_contact_name', 'emergency_contact_phone',
        'bank_account_number', 'bank_ifsc',
    ];

    protected function casts(): array
    {
        return [
            'is_active' => 'boolean',
            'created_at' => 'datetime',
            'updated_at' => 'datetime',
            'date_of_birth' => 'date',
            'date_of_joining' => 'date',
            'date_of_leaving' => 'date',
        ];
    }

    public function user(): BelongsTo { return $this->belongsTo(HrmsUser::class, 'user_id'); }
    public function company(): BelongsTo { return $this->belongsTo(HrmsCompany::class, 'company_id'); }
    public function division(): BelongsTo { return $this->belongsTo(HrmsDivision::class, 'division_id'); }
    public function department(): BelongsTo { return $this->belongsTo(HrmsDepartment::class, 'department_id'); }
    public function designation(): BelongsTo { return $this->belongsTo(HrmsDesignation::class, 'designation_id'); }
    public function manager(): BelongsTo { return $this->belongsTo(self::class, 'manager_id'); }
    public function role(): BelongsTo { return $this->belongsTo(HrmsRole::class, 'role_id'); }
}
