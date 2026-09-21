<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Configurable Transport Allowance slabs on the institute profile (same pattern as DA/HRA).
 */
return new class extends Migration
{
    public function up(): void
    {
        $tableName = Schema::hasTable('cirt_institute')
            ? 'cirt_institute'
            : (Schema::hasTable('cirt_companies') ? 'cirt_companies' : null);

        if ($tableName === null) {
            return;
        }

        Schema::table($tableName, function (Blueprint $table) use ($tableName) {
            if (! Schema::hasColumn($tableName, 'transport_allowance_level_9_plus')) {
                $table->decimal('transport_allowance_level_9_plus', 12, 2)->default(7200)->after('default_hra_percent');
            }
            if (! Schema::hasColumn($tableName, 'transport_allowance_level_3_8')) {
                $table->decimal('transport_allowance_level_3_8', 12, 2)->default(3600)->after('transport_allowance_level_9_plus');
            }
            if (! Schema::hasColumn($tableName, 'transport_allowance_level_1_2')) {
                $table->decimal('transport_allowance_level_1_2', 12, 2)->default(1350)->after('transport_allowance_level_3_8');
            }
            if (! Schema::hasColumn($tableName, 'transport_allowance_level_1_2_enhanced')) {
                $table->decimal('transport_allowance_level_1_2_enhanced', 12, 2)->default(3600)->after('transport_allowance_level_1_2');
            }
            if (! Schema::hasColumn($tableName, 'transport_allowance_basic_threshold')) {
                $table->decimal('transport_allowance_basic_threshold', 12, 2)->default(24200)->after('transport_allowance_level_1_2_enhanced');
            }
        });
    }

    public function down(): void
    {
        $tableName = Schema::hasTable('cirt_institute')
            ? 'cirt_institute'
            : (Schema::hasTable('cirt_companies') ? 'cirt_companies' : null);

        if ($tableName === null) {
            return;
        }

        Schema::table($tableName, function (Blueprint $table) use ($tableName) {
            foreach ([
                'transport_allowance_level_9_plus',
                'transport_allowance_level_3_8',
                'transport_allowance_level_1_2',
                'transport_allowance_level_1_2_enhanced',
                'transport_allowance_basic_threshold',
            ] as $col) {
                if (Schema::hasColumn($tableName, $col)) {
                    $table->dropColumn($col);
                }
            }
        });
    }
};
