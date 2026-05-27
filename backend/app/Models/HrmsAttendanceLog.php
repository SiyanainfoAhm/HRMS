<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class HrmsAttendanceLog extends Model
{
    use HasUuids;

    protected $table = 'HRMS_attendance_logs';
    protected $keyType = 'string';
    public $incrementing = false;

    protected $fillable = [
        'company_id', 'employee_id', 'work_date',
        'check_in_at', 'check_in_lat', 'check_in_lng',
        'check_out_at', 'check_out_lat', 'check_out_lng',
        'total_hours', 'status',
        'lunch_check_out_at', 'lunch_check_in_at',
        'tea_check_out_at', 'tea_check_in_at',
        'lunch_break_started_at', 'tea_break_started_at',
        'break_minutes', 'lunch_break_minutes', 'tea_break_minutes',
    ];

    protected function casts(): array
    {
        return [
            'work_date' => 'date',
            'check_in_at' => 'datetime',
            'check_out_at' => 'datetime',
            'lunch_check_out_at' => 'datetime',
            'lunch_check_in_at' => 'datetime',
            'tea_check_out_at' => 'datetime',
            'tea_check_in_at' => 'datetime',
            'lunch_break_started_at' => 'datetime',
            'tea_break_started_at' => 'datetime',
            'total_hours' => 'decimal:2',
            'break_minutes' => 'integer',
            'lunch_break_minutes' => 'integer',
            'tea_break_minutes' => 'integer',
            'created_at' => 'datetime',
            'updated_at' => 'datetime',
        ];
    }

    public function employee(): BelongsTo
    {
        return $this->belongsTo(HrmsEmployee::class, 'employee_id');
    }

    public function company(): BelongsTo
    {
        return $this->belongsTo(HrmsCompany::class, 'company_id');
    }
}
