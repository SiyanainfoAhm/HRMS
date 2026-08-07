<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('cirt_payroll_master')) {
            return;
        }

        if (Schema::hasColumn('cirt_payroll_master', 'employee_user_id')) {
            DB::statement('ALTER TABLE cirt_payroll_master ALTER COLUMN employee_user_id DROP NOT NULL');
        }
    }

    public function down(): void
    {
        if (! Schema::hasTable('cirt_payroll_master')) {
            return;
        }

        // Only re-apply NOT NULL if no orphan rows exist
        $orphans = DB::table('cirt_payroll_master')->whereNull('employee_user_id')->count();
        if ($orphans === 0 && Schema::hasColumn('cirt_payroll_master', 'employee_user_id')) {
            DB::statement('ALTER TABLE cirt_payroll_master ALTER COLUMN employee_user_id SET NOT NULL');
        }
    }
};
