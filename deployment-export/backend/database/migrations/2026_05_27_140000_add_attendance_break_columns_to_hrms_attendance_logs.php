<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('HRMS_attendance_logs')) {
            return;
        }

        $add = function (string $column, string $sql): void {
            if (! Schema::hasColumn('HRMS_attendance_logs', $column)) {
                DB::statement($sql);
            }
        };

        $add('lunch_check_out_at', 'alter table "HRMS_attendance_logs" add column lunch_check_out_at timestamptz');
        $add('lunch_check_in_at', 'alter table "HRMS_attendance_logs" add column lunch_check_in_at timestamptz');
        $add('tea_check_out_at', 'alter table "HRMS_attendance_logs" add column tea_check_out_at timestamptz');
        $add('tea_check_in_at', 'alter table "HRMS_attendance_logs" add column tea_check_in_at timestamptz');
        $add('lunch_break_started_at', 'alter table "HRMS_attendance_logs" add column lunch_break_started_at timestamptz');
        $add('tea_break_started_at', 'alter table "HRMS_attendance_logs" add column tea_break_started_at timestamptz');
        $add(
            'lunch_break_minutes',
            'alter table "HRMS_attendance_logs" add column lunch_break_minutes integer not null default 0'
        );
        $add(
            'tea_break_minutes',
            'alter table "HRMS_attendance_logs" add column tea_break_minutes integer not null default 0'
        );
        $add(
            'break_minutes',
            'alter table "HRMS_attendance_logs" add column break_minutes integer not null default 0'
        );
    }

    public function down(): void
    {
        // Non-destructive: leave columns in place if rolled back after partial deploy.
    }
};
