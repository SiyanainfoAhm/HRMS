<?php

namespace App\Models;

use App\Casts\UserRoleCast;
use App\Enums\AuthProvider;
use App\Enums\EmploymentStatus;
use App\Enums\UserRole;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Illuminate\Notifications\Notifiable;
use Laravel\Sanctum\HasApiTokens;

class HrmsUser extends Authenticatable
{
    use HasApiTokens;
    use HasUuids;
    use Notifiable;

    protected $table = 'cirt_users';
    protected $keyType = 'string';
    public $incrementing = false;

    protected $fillable = [
        'email', 'password_hash', 'name', 'role', 'auth_provider',
        'auth_session_version', 'company_id', 'employee_code',
        'employment_status', 'phone', 'date_of_birth', 'date_of_joining',
        'date_of_leaving',
        'current_address_line1', 'current_address_line2', 'current_city',
        'current_state', 'current_country', 'current_postal_code',
        'permanent_address_line1', 'permanent_address_line2', 'permanent_city',
        'permanent_state', 'permanent_country', 'permanent_postal_code',
        'emergency_contact_name', 'emergency_contact_phone',
        'bank_name', 'bank_account_holder_name', 'bank_account_number', 'bank_ifsc',
        'ctc', 'gross_salary', 'gender', 'designation',
        'designation_id', 'department_id', 'division_id', 'shift_id',
        'aadhaar', 'pan', 'uan_number', 'pf_number', 'esic_number',
        'pf_eligible', 'esic_eligible',
        'government_pay_level', 'cpf_number', 'tds_monthly',
    ];

    protected $hidden = [
        'password_hash',
    ];

    protected function casts(): array
    {
        return [
            'role' => UserRoleCast::class,
            'auth_provider' => AuthProvider::class,
            'employment_status' => EmploymentStatus::class,
            'auth_session_version' => 'integer',
            'created_at' => 'datetime',
            'updated_at' => 'datetime',
            'date_of_birth' => 'date',
            'date_of_joining' => 'date',
            'date_of_leaving' => 'date',
            'ctc' => 'decimal:2',
            'gross_salary' => 'decimal:2',
            'tds_monthly' => 'decimal:2',
            'pf_eligible' => 'boolean',
            'esic_eligible' => 'boolean',
            'government_pay_level' => 'integer',
        ];
    }

    public function getAuthPassword(): string
    {
        return (string) $this->password_hash;
    }

    public function hasManagerialRole(): bool
    {
        $role = $this->role;
        if ($role instanceof UserRole) {
            return $role->isManagerial();
        }

        return UserRole::isManagerialValue(is_string($role) ? $role : null);
    }

    public function employee(): HasOne
    {
        return $this->hasOne(HrmsEmployee::class, 'user_id');
    }

    public function payrollMasters(): HasMany
    {
        return $this->hasMany(HrmsPayrollMaster::class, 'employee_user_id');
    }

    public function payslips(): HasMany
    {
        return $this->hasMany(HrmsPayslip::class, 'employee_user_id');
    }

    public function bankAccounts(): HasMany
    {
        return $this->hasMany(HrmsEmployeeBankAccount::class, 'user_id');
    }
}
