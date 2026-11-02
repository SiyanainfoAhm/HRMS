<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;

/** Child row of an Activity Log entry: Changed Item | Previous Value | Updated Value (CIRT-10). */
class HrmsActivityLogDetail extends Model
{
    use HasUuids;

    protected $table = 'cirt_activity_log_details';
    protected $keyType = 'string';
    public $incrementing = false;
    public $timestamps = false;
    protected $guarded = [];
}
