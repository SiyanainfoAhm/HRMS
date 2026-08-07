<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class HrmsPayrollDraft extends Model
{
    use HasUuids;

    protected $table = 'cirt_payroll_drafts';

    protected $keyType = 'string';

    public $incrementing = false;

    protected $guarded = [];

    protected $casts = [
        'payroll_month' => 'integer',
        'payroll_year' => 'integer',
        'version' => 'integer',
        'finalized_at' => 'datetime',
    ];

    public const STATUS_DRAFT = 'draft';

    public const STATUS_FINALIZED = 'finalized';

    public const STATUS_DISCARDED = 'discarded';

    public function employees(): HasMany
    {
        return $this->hasMany(HrmsPayrollDraftEmployee::class, 'payroll_draft_id');
    }

    public function company(): BelongsTo
    {
        return $this->belongsTo(HrmsCompany::class, 'company_id');
    }
}
