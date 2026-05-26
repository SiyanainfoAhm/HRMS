<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class HrmsEmployeeInvite extends Model
{
    use HasUuids;

    protected $table = 'HRMS_employee_invites';
    protected $keyType = 'string';
    public $incrementing = false;

    const UPDATED_AT = null;

    protected $fillable = [
        'company_id', 'user_id', 'email', 'token',
        'requested_document_ids', 'status', 'expires_at',
        'completed_at', 'created_by',
    ];

    protected function casts(): array
    {
        return [
            'requested_document_ids' => 'array',
            'expires_at' => 'datetime',
            'completed_at' => 'datetime',
            'created_at' => 'datetime',
        ];
    }

    public function company(): BelongsTo { return $this->belongsTo(HrmsCompany::class, 'company_id'); }
    public function user(): BelongsTo { return $this->belongsTo(HrmsUser::class, 'user_id'); }
}
