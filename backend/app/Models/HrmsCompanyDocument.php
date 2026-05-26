<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class HrmsCompanyDocument extends Model
{
    use HasUuids;

    protected $table = 'HRMS_company_documents';
    protected $keyType = 'string';
    public $incrementing = false;

    protected $fillable = [
        'company_id', 'name', 'kind', 'is_mandatory', 'content_text',
    ];

    protected function casts(): array
    {
        return [
            'is_mandatory' => 'boolean',
            'created_at' => 'datetime',
            'updated_at' => 'datetime',
        ];
    }

    public function company(): BelongsTo
    {
        return $this->belongsTo(HrmsCompany::class, 'company_id');
    }
}
