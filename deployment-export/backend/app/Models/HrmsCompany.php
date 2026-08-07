<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

class HrmsCompany extends Model
{
    use HasUuids;

    /** Single CIRT institute row (table renamed from legacy cirt_companies). */
    protected $table = 'cirt_institute';
    protected $keyType = 'string';
    public $incrementing = false;

    protected $fillable = [
        'name', 'code', 'industry',
        'address_line1', 'address_line2', 'city', 'state', 'country', 'postal_code',
        'phone', 'professional_tax_annual', 'professional_tax_monthly', 'default_da_percent', 'default_hra_percent', 'logo_url',
    ];

    protected function casts(): array
    {
        return [
            'professional_tax_annual' => 'decimal:2',
            'professional_tax_monthly' => 'decimal:2',
            'default_da_percent' => 'decimal:2',
            'default_hra_percent' => 'decimal:2',
            'created_at' => 'datetime',
            'updated_at' => 'datetime',
        ];
    }

    public function users(): HasMany { return $this->hasMany(HrmsUser::class, 'company_id'); }
    public function employees(): HasMany { return $this->hasMany(HrmsEmployee::class, 'company_id'); }
    public function divisions(): HasMany { return $this->hasMany(HrmsDivision::class, 'company_id'); }
    public function departments(): HasMany { return $this->hasMany(HrmsDepartment::class, 'company_id'); }
    public function designations(): HasMany { return $this->hasMany(HrmsDesignation::class, 'company_id'); }
    public function roles(): HasMany { return $this->hasMany(HrmsRole::class, 'company_id'); }
}
