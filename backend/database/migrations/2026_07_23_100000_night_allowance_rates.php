<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /** @var list<array{slab_no: int, pay_level: int, rate_per_hour: float}> */
    private const DEFAULT_RATES = [
        ['slab_no' => 1, 'pay_level' => 1, 'rate_per_hour' => 23.20],
        ['slab_no' => 2, 'pay_level' => 2, 'rate_per_hour' => 26.10],
        ['slab_no' => 3, 'pay_level' => 3, 'rate_per_hour' => 28.85],
        ['slab_no' => 4, 'pay_level' => 4, 'rate_per_hour' => 32.65],
        ['slab_no' => 5, 'pay_level' => 5, 'rate_per_hour' => 36.55],
        ['slab_no' => 6, 'pay_level' => 5, 'rate_per_hour' => 38.05],
        ['slab_no' => 7, 'pay_level' => 5, 'rate_per_hour' => 39.60],
        ['slab_no' => 8, 'pay_level' => 5, 'rate_per_hour' => 41.25],
        ['slab_no' => 9, 'pay_level' => 6, 'rate_per_hour' => 43.50],
        ['slab_no' => 10, 'pay_level' => 6, 'rate_per_hour' => 46.00],
        ['slab_no' => 11, 'pay_level' => 7, 'rate_per_hour' => 50.40],
        ['slab_no' => 12, 'pay_level' => 8, 'rate_per_hour' => 55.45],
        ['slab_no' => 13, 'pay_level' => 8, 'rate_per_hour' => 58.55],
        ['slab_no' => 14, 'pay_level' => 9, 'rate_per_hour' => 63.60],
    ];

    public function up(): void
    {
        if (! Schema::hasTable('cirt_night_allowance_rates')) {
            Schema::create('cirt_night_allowance_rates', function (Blueprint $table) {
                $table->uuid('id')->primary();
                $table->uuid('company_id');
                $table->unsignedInteger('slab_no');
                $table->unsignedSmallInteger('pay_level');
                $table->decimal('rate_per_hour', 12, 2);
                $table->date('effective_from')->nullable();
                $table->boolean('is_active')->default(true);
                $table->timestamps();
                $table->unique(['company_id', 'slab_no']);
                $table->index(['company_id', 'pay_level', 'is_active']);
            });
        }

        if (Schema::hasTable('cirt_payroll_master')) {
            Schema::table('cirt_payroll_master', function (Blueprint $table) {
                if (! Schema::hasColumn('cirt_payroll_master', 'night_allowance_slab_no')) {
                    $table->unsignedInteger('night_allowance_slab_no')->nullable();
                }
            });
        }

        if (Schema::hasTable('cirt_monthly_payroll')) {
            Schema::table('cirt_monthly_payroll', function (Blueprint $table) {
                foreach ([
                    'night_hours' => fn () => $table->decimal('night_hours', 12, 2)->default(0),
                    'night_allowance_rate' => fn () => $table->decimal('night_allowance_rate', 12, 2)->default(0),
                    'night_allowance_amount' => fn () => $table->decimal('night_allowance_amount', 12, 2)->default(0),
                    'night_allowance_slab_no' => fn () => $table->unsignedInteger('night_allowance_slab_no')->nullable(),
                    'night_allowance_manual_override' => fn () => $table->boolean('night_allowance_manual_override')->default(false),
                ] as $col => $adder) {
                    if (! Schema::hasColumn('cirt_monthly_payroll', $col)) {
                        $adder();
                    }
                }
            });
        }

        $this->seedDefaultRatesForCompanies();
    }

    private function seedDefaultRatesForCompanies(): void
    {
        if (! Schema::hasTable('cirt_night_allowance_rates') || ! Schema::hasTable('cirt_companies')) {
            return;
        }

        $companyIds = DB::table('cirt_companies')->pluck('id');
        foreach ($companyIds as $companyId) {
            $exists = DB::table('cirt_night_allowance_rates')
                ->where('company_id', $companyId)
                ->exists();
            if ($exists) {
                continue;
            }
            $now = now();
            foreach (self::DEFAULT_RATES as $row) {
                DB::table('cirt_night_allowance_rates')->insert([
                    'id' => (string) \Illuminate\Support\Str::uuid(),
                    'company_id' => $companyId,
                    'slab_no' => $row['slab_no'],
                    'pay_level' => $row['pay_level'],
                    'rate_per_hour' => $row['rate_per_hour'],
                    'effective_from' => null,
                    'is_active' => true,
                    'created_at' => $now,
                    'updated_at' => $now,
                ]);
            }
        }
    }

    public function down(): void
    {
        // Non-destructive — retain snapshots and configured rates.
    }
};
