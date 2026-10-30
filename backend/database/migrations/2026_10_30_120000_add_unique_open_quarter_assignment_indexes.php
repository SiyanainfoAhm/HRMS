<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        $duplicateEmployees = DB::table('cirt_quarter_assignments')
            ->select('company_id', 'employee_id')->whereNull('assigned_to')
            ->groupBy('company_id', 'employee_id')->havingRaw('COUNT(*) > 1')->limit(1)->exists();
        $duplicateQuarters = DB::table('cirt_quarter_assignments')
            ->select('company_id', 'quarter_id')->whereNull('assigned_to')
            ->groupBy('company_id', 'quarter_id')->havingRaw('COUNT(*) > 1')->limit(1)->exists();
        if ($duplicateEmployees || $duplicateQuarters) {
            throw new RuntimeException('Cannot add active quarter assignment constraints: duplicate open assignments exist. Run the read-only CIRT quarter reconciliation and resolve each ambiguity first.');
        }

        DB::statement('CREATE UNIQUE INDEX cirt_quarter_assignment_one_open_per_employee ON cirt_quarter_assignments (company_id, employee_id) WHERE assigned_to IS NULL');
        DB::statement('CREATE UNIQUE INDEX cirt_quarter_assignment_one_open_per_quarter ON cirt_quarter_assignments (company_id, quarter_id) WHERE assigned_to IS NULL');
    }

    public function down(): void
    {
        DB::statement('DROP INDEX IF EXISTS cirt_quarter_assignment_one_open_per_employee');
        DB::statement('DROP INDEX IF EXISTS cirt_quarter_assignment_one_open_per_quarter');
    }
};
