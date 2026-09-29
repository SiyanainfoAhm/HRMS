<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        if (! Schema::hasTable('cirt_electricity_tariff_slabs')) return;
        if (! Schema::hasColumn('cirt_electricity_tariff_slabs', 'fuel_charge_per_unit')) {
            Schema::table('cirt_electricity_tariff_slabs', function (Blueprint $table) {
                // No column-order directive: this migration must work on both
                // MySQL and PostgreSQL client installations.
                $table->decimal('fuel_charge_per_unit', 12, 4)->default(0);
            });
        }

        // Initial configurable rates supplied by Payroll; existing historical
        // records stay intact unless they use the reference April 2026 tariff.
        $rates = [0.3500, 0.6500, 0.8500, 0.9500, 0.9500];
        $tariffIds = DB::table('cirt_electricity_tariffs')->whereDate('effective_from', '2026-04-01')->pluck('id');
        foreach ($tariffIds as $tariffId) {
            DB::table('cirt_electricity_tariff_slabs')->where('tariff_id', $tariffId)
                ->orderBy('sort_order')->get()->each(function ($slab, int $i) use ($rates) {
                    DB::table('cirt_electricity_tariff_slabs')->where('id', $slab->id)
                        ->update(['fuel_charge_per_unit' => $rates[$i] ?? 0.9500]);
                });
            // This tariff has been converted to slab fuel rates; its former
            // flat amount must not appear as an additional fixed charge.
            DB::table('cirt_electricity_tariffs')->where('id', $tariffId)->update(['fuel_charge' => 0]);
        }
    }

    public function down(): void
    {
        if (Schema::hasTable('cirt_electricity_tariff_slabs') && Schema::hasColumn('cirt_electricity_tariff_slabs', 'fuel_charge_per_unit')) {
            Schema::table('cirt_electricity_tariff_slabs', fn (Blueprint $table) => $table->dropColumn('fuel_charge_per_unit'));
        }
    }
};
