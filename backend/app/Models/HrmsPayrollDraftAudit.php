<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class HrmsPayrollDraftAudit extends Model
{
    use HasUuids;

    protected $table = 'cirt_payroll_draft_audits';
    protected $keyType = 'string';
    public $incrementing = false;

    const UPDATED_AT = null;

    protected $guarded = [];

    protected $casts = [
        'employee_snapshot' => 'array',
        'created_at' => 'datetime',
    ];

    public function performedBy(): BelongsTo
    {
        return $this->belongsTo(HrmsUser::class, 'performed_by');
    }
}
