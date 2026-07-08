<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('cirt_payroll_calculation_settings')) {
            Schema::table('cirt_payroll_calculation_settings', function (Blueprint $table) {
                if (! Schema::hasColumn('cirt_payroll_calculation_settings', 'night_allowance_basic_ceiling')) {
                    $table->decimal('night_allowance_basic_ceiling', 12, 2)->default(43600);
                }
            });
        }

        if (Schema::hasTable('cirt_monthly_payroll')) {
            Schema::table('cirt_monthly_payroll', function (Blueprint $table) {
                foreach ([
                    'night_allowance_basic_ceiling' => fn () => $table->decimal('night_allowance_basic_ceiling', 12, 2)->nullable(),
                    'night_allowance_eligible' => fn () => $table->boolean('night_allowance_eligible')->default(true),
                ] as $col => $adder) {
                    if (! Schema::hasColumn('cirt_monthly_payroll', $col)) {
                        $adder();
                    }
                }
            });
        }
    }

    public function down(): void
    {
        // Non-destructive — retain snapshots.
    }
};
