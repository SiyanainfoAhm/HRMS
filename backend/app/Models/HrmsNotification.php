<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class HrmsNotification extends Model
{
    use HasUuids;

    protected $table = 'HRMS_notifications';
    protected $keyType = 'string';
    public $incrementing = false;
    public $timestamps = false;

    protected $fillable = [
        'company_id', 'title', 'message', 'audience',
        'department_id', 'employee_id', 'created_by',
        'created_at', 'valid_from', 'valid_to',
    ];

    protected function casts(): array
    {
        return [
            'created_at' => 'datetime',
            'valid_from' => 'datetime',
            'valid_to' => 'datetime',
        ];
    }

    public function company(): BelongsTo
    {
        return $this->belongsTo(HrmsCompany::class, 'company_id');
    }
}
