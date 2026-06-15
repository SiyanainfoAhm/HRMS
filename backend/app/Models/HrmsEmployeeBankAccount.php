<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class HrmsEmployeeBankAccount extends Model
{
    use HasUuids;

    protected $table = 'cirt_employee_bank_accounts';
    protected $keyType = 'string';
    public $incrementing = false;

    const UPDATED_AT = null;

    protected $fillable = [
        'company_id', 'user_id', 'bank_name', 'bank_account_number',
        'bank_ifsc', 'is_active', 'effective_from', 'effective_to', 'created_by',
    ];

    protected function casts(): array
    {
        return [
            'is_active' => 'boolean',
            'effective_from' => 'datetime',
            'effective_to' => 'datetime',
            'created_at' => 'datetime',
        ];
    }

    public function user(): BelongsTo { return $this->belongsTo(HrmsUser::class, 'user_id'); }
}
