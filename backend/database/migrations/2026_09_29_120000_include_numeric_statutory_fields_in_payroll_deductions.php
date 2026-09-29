<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        if (! Schema::hasTable('cirt_payroll_field_definitions')) {
            return;
        }

        // Correct fields created before statutory numeric fields were exposed
        // as deductions in the Settings UI. Do not affect statutory text IDs.
        DB::table('cirt_payroll_field_definitions')
            ->where('field_group', 'statutory')
            ->where('field_type', 'number')
            ->update(['include_in_total_deductions' => true]);
    }

    public function down(): void
    {
        // Inclusion is payroll business data; do not remove it on rollback.
    }
};
