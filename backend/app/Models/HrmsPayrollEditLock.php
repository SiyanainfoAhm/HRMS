<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;

class HrmsPayrollEditLock extends Model
{
    use HasUuids;

    protected $table = 'cirt_payroll_edit_locks';
    protected $keyType = 'string';
    public $incrementing = false;
    protected $guarded = [];
    protected $casts = ['heartbeat_at' => 'immutable_datetime', 'expires_at' => 'immutable_datetime'];
}
