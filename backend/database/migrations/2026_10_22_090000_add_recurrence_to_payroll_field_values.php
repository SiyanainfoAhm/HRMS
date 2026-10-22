<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('cirt_payroll_field_values', function (Blueprint $table): void {
            $table->date('effective_from')->nullable()->after('field_value');
            $table->date('effective_to')->nullable()->after('effective_from');
            $table->string('recurrence', 20)->default('recurring')->after('effective_to');
            $table->string('source_reference', 255)->nullable()->after('recurrence');
            $table->index(['company_id', 'payroll_master_id', 'effective_from', 'effective_to'], 'idx_cirt_pfv_effective');
        });
    }

    public function down(): void
    {
        Schema::table('cirt_payroll_field_values', function (Blueprint $table): void {
            $table->dropIndex('idx_cirt_pfv_effective');
            $table->dropColumn(['effective_from', 'effective_to', 'recurrence', 'source_reference']);
        });
    }
};
