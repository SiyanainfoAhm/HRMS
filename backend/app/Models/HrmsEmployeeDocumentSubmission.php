<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class HrmsEmployeeDocumentSubmission extends Model
{
    use HasUuids;

    protected $table = 'HRMS_employee_document_submissions';
    protected $keyType = 'string';
    public $incrementing = false;

    protected $fillable = [
        'company_id', 'invite_id', 'user_id', 'document_id',
        'status', 'file_url', 'signature_name', 'signed_at',
        'submitted_at', 'reviewed_at', 'reviewed_by', 'review_note',
    ];

    protected function casts(): array
    {
        return [
            'signed_at' => 'datetime',
            'submitted_at' => 'datetime',
            'reviewed_at' => 'datetime',
            'created_at' => 'datetime',
            'updated_at' => 'datetime',
        ];
    }

    public function company(): BelongsTo { return $this->belongsTo(HrmsCompany::class, 'company_id'); }
    public function document(): BelongsTo { return $this->belongsTo(HrmsCompanyDocument::class, 'document_id'); }
    public function user(): BelongsTo { return $this->belongsTo(HrmsUser::class, 'user_id'); }
}
