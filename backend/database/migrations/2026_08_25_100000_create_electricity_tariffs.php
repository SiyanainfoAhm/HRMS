<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;

/**
 * Dynamic electricity tariff configuration (effective-dated) + monthly snapshot columns.
 * Additive only — does not overwrite existing electricity_amount values.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('cirt_electricity_tariffs')) {
            Schema::create('cirt_electricity_tariffs', function (Blueprint $table) {
                $table->uuid('id')->primary();
                $table->uuid('company_id');
                $table->date('effective_from');
                $table->decimal('sthir_aakar', 12, 2)->default(0);
                $table->decimal('vahan_aakar_per_unit', 12, 4)->default(0);
                $table->decimal('fuel_charge', 12, 2)->default(0);
                $table->decimal('duty_percentage', 8, 4)->default(0);
                $table->boolean('is_active')->default(true);
                $table->uuid('created_by')->nullable();
                $table->timestamps();

                $table->index(['company_id', 'effective_from', 'is_active'], 'cirt_elec_tariffs_eff_idx');
                $table->unique(['company_id', 'effective_from'], 'cirt_elec_tariffs_company_eff_uq');
            });

            if (Schema::hasTable('cirt_institute')) {
                Schema::table('cirt_electricity_tariffs', function (Blueprint $table) {
                    $table->foreign('company_id')->references('id')->on('cirt_institute')->cascadeOnDelete();
                });
            }
        }

        if (! Schema::hasTable('cirt_electricity_tariff_slabs')) {
            Schema::create('cirt_electricity_tariff_slabs', function (Blueprint $table) {
                $table->uuid('id')->primary();
                $table->uuid('tariff_id');
                $table->unsignedInteger('from_unit');
                $table->unsignedInteger('to_unit')->nullable();
                $table->decimal('rate_per_unit', 12, 4);
                $table->unsignedInteger('sort_order')->default(0);
                $table->timestamps();

                $table->foreign('tariff_id')
                    ->references('id')
                    ->on('cirt_electricity_tariffs')
                    ->cascadeOnDelete();
                $table->index(['tariff_id', 'sort_order'], 'cirt_elec_slabs_tariff_idx');
            });
        }

        if (Schema::hasTable('cirt_monthly_payroll')) {
            Schema::table('cirt_monthly_payroll', function (Blueprint $table) {
                $cols = [
                    'electricity_tariff_id' => fn () => $table->uuid('electricity_tariff_id')->nullable(),
                    'electricity_sthir_aakar' => fn () => $table->decimal('electricity_sthir_aakar', 12, 2)->default(0),
                    'electricity_consumption_charge' => fn () => $table->decimal('electricity_consumption_charge', 12, 2)->default(0),
                    'electricity_vahan_aakar' => fn () => $table->decimal('electricity_vahan_aakar', 12, 2)->default(0),
                    'electricity_fuel_charge' => fn () => $table->decimal('electricity_fuel_charge', 12, 2)->default(0),
                    'electricity_duty' => fn () => $table->decimal('electricity_duty', 12, 2)->default(0),
                    'electricity_total' => fn () => $table->decimal('electricity_total', 12, 2)->default(0),
                    'electricity_applicable' => fn () => $table->boolean('electricity_applicable')->default(true),
                    'electricity_mode' => fn () => $table->string('electricity_mode', 32)->default('unit_based'),
                ];
                foreach ($cols as $name => $adder) {
                    if (! Schema::hasColumn('cirt_monthly_payroll', $name)) {
                        $adder();
                    }
                }
            });
        }

        if (Schema::hasTable('cirt_payroll_master')) {
            Schema::table('cirt_payroll_master', function (Blueprint $table) {
                if (! Schema::hasColumn('cirt_payroll_master', 'electricity_applicable')) {
                    $table->boolean('electricity_applicable')->default(true);
                }
                if (! Schema::hasColumn('cirt_payroll_master', 'electricity_mode')) {
                    $table->string('electricity_mode', 32)->default('manual_fixed');
                }
            });
        }

        $this->seedApril2026Tariff();
    }

    private function seedApril2026Tariff(): void
    {
        if (! Schema::hasTable('cirt_electricity_tariffs') || ! Schema::hasTable('cirt_institute')) {
            return;
        }

        $slabs = [
            ['from_unit' => 0, 'to_unit' => 100, 'rate_per_unit' => 3.96, 'sort_order' => 1],
            ['from_unit' => 101, 'to_unit' => 300, 'rate_per_unit' => 10.80, 'sort_order' => 2],
            ['from_unit' => 301, 'to_unit' => 500, 'rate_per_unit' => 15.03, 'sort_order' => 3],
            ['from_unit' => 501, 'to_unit' => 1000, 'rate_per_unit' => 17.53, 'sort_order' => 4],
            ['from_unit' => 1001, 'to_unit' => null, 'rate_per_unit' => 17.53, 'sort_order' => 5],
        ];

        $companyIds = DB::table('cirt_institute')->pluck('id');
        foreach ($companyIds as $companyId) {
            $exists = DB::table('cirt_electricity_tariffs')
                ->where('company_id', $companyId)
                ->whereDate('effective_from', '2026-04-01')
                ->exists();
            if ($exists) {
                continue;
            }

            $tariffId = (string) Str::uuid();
            $now = now();
            DB::table('cirt_electricity_tariffs')->insert([
                'id' => $tariffId,
                'company_id' => $companyId,
                'effective_from' => '2026-04-01',
                'sthir_aakar' => 130,
                'vahan_aakar_per_unit' => 1.60,
                'fuel_charge' => 200.70,
                'duty_percentage' => 16,
                'is_active' => true,
                'created_by' => null,
                'created_at' => $now,
                'updated_at' => $now,
            ]);

            foreach ($slabs as $slab) {
                DB::table('cirt_electricity_tariff_slabs')->insert([
                    'id' => (string) Str::uuid(),
                    'tariff_id' => $tariffId,
                    'from_unit' => $slab['from_unit'],
                    'to_unit' => $slab['to_unit'],
                    'rate_per_unit' => $slab['rate_per_unit'],
                    'sort_order' => $slab['sort_order'],
                    'created_at' => $now,
                    'updated_at' => $now,
                ]);
            }
        }
    }

    public function down(): void
    {
        // Non-destructive — retain tariffs and monthly electricity snapshots.
    }
};
