<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Editable Pay Level band boundaries for Transport Allowance slabs.
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
            if (! Schema::hasColumn($tableName, 'transport_allowance_high_min_level')) {
                $table->unsignedSmallInteger('transport_allowance_high_min_level')->default(9)
                    ->after('transport_allowance_basic_threshold');
            }
            if (! Schema::hasColumn($tableName, 'transport_allowance_mid_min_level')) {
                $table->unsignedSmallInteger('transport_allowance_mid_min_level')->default(3)
                    ->after('transport_allowance_high_min_level');
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
            foreach (['transport_allowance_high_min_level', 'transport_allowance_mid_min_level'] as $col) {
                if (Schema::hasColumn($tableName, $col)) {
                    $table->dropColumn($col);
                }
            }
        });
    }
};
