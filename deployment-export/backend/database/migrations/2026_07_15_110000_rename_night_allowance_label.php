<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('cirt_payroll_field_definitions')) {
            return;
        }

        DB::table('cirt_payroll_field_definitions')
            ->where('field_key', 'night_allowance')
            ->update([
                'field_label' => 'N. All.',
                'updated_at' => now(),
            ]);
    }

    public function down(): void
    {
        if (! Schema::hasTable('cirt_payroll_field_definitions')) {
            return;
        }

        DB::table('cirt_payroll_field_definitions')
            ->where('field_key', 'night_allowance')
            ->update([
                'field_label' => 'Night Allowance',
                'updated_at' => now(),
            ]);
    }
};
