<?php

use App\Support\QuarterTypes;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;

return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('cirt_quarter_types')) {
            Schema::create('cirt_quarter_types', function (Blueprint $table) {
                $table->uuid('id')->primary();
                $table->uuid('company_id');
                $table->string('name', 100);
                $table->string('normalized_name', 100);
                $table->boolean('is_active')->default(true);
                $table->unsignedInteger('sort_order')->nullable();
                $table->uuid('created_by')->nullable();
                $table->uuid('updated_by')->nullable();
                $table->timestamps();

                $table->index(['company_id'], 'cirt_quarter_types_company_idx');
                $table->index(['company_id', 'is_active'], 'cirt_quarter_types_company_active_idx');
                $table->unique(['company_id', 'normalized_name'], 'cirt_quarter_types_company_norm_unique');
            });
        }

        if (Schema::hasTable('cirt_quarters')) {
            Schema::table('cirt_quarters', function (Blueprint $table) {
                if (! Schema::hasColumn('cirt_quarters', 'quarter_type_id')) {
                    $table->uuid('quarter_type_id')->nullable()->after('quarter_type');
                    $table->index(['company_id', 'quarter_type_id'], 'cirt_quarters_company_type_idx');
                }
            });

            // Widen denormalized label so custom type names fit.
            DB::statement('ALTER TABLE cirt_quarters ALTER COLUMN quarter_type TYPE VARCHAR(100)');
        }

        if (Schema::hasTable('cirt_monthly_payroll') && Schema::hasColumn('cirt_monthly_payroll', 'quarter_type')) {
            DB::statement('ALTER TABLE cirt_monthly_payroll ALTER COLUMN quarter_type TYPE VARCHAR(100)');
        }

        $this->seedAndMapTypes();

        // Case-insensitive, whitespace-normalized uniqueness for quarter names.
        if (Schema::hasTable('cirt_quarters')) {
            try {
                DB::statement('ALTER TABLE cirt_quarters DROP CONSTRAINT IF EXISTS cirt_quarters_company_name_unique');
            } catch (\Throwable) {
                // ignore
            }
            DB::statement('DROP INDEX IF EXISTS cirt_quarters_company_name_unique');
            DB::statement("
                CREATE UNIQUE INDEX IF NOT EXISTS cirt_quarters_company_name_ci_unique
                ON cirt_quarters (
                    company_id,
                    lower(regexp_replace(btrim(quarter_name), '\\s+', ' ', 'g'))
                )
            ");
        }
    }

    public function down(): void
    {
        if (Schema::hasTable('cirt_quarters')) {
            DB::statement('DROP INDEX IF EXISTS cirt_quarters_company_name_ci_unique');
            Schema::table('cirt_quarters', function (Blueprint $table) {
                if (Schema::hasColumn('cirt_quarters', 'quarter_type_id')) {
                    $table->dropIndex('cirt_quarters_company_type_idx');
                    $table->dropColumn('quarter_type_id');
                }
            });
            try {
                DB::statement('
                    CREATE UNIQUE INDEX IF NOT EXISTS cirt_quarters_company_name_unique
                    ON cirt_quarters (company_id, quarter_name)
                ');
            } catch (\Throwable) {
                // ignore
            }
            // Intentionally keep VARCHAR(100) on quarter_type (safe reverse).
        }

        Schema::dropIfExists('cirt_quarter_types');
    }

    private function seedAndMapTypes(): void
    {
        if (! Schema::hasTable('cirt_quarter_types') || ! Schema::hasTable('cirt_quarters')) {
            return;
        }

        $companyIds = DB::table('cirt_quarters')->distinct()->pluck('company_id')->filter()->values()->all();
        if ($companyIds === [] && Schema::hasTable('cirt_institute')) {
            $companyIds = DB::table('cirt_institute')->pluck('id')->filter()->values()->all();
        }

        $defaults = QuarterTypes::defaults();
        $now = now();

        foreach ($companyIds as $companyId) {
            $companyId = (string) $companyId;
            $sort = 1;
            foreach ($defaults as $name) {
                $normalized = $this->normalize($name);
                $exists = DB::table('cirt_quarter_types')
                    ->where('company_id', $companyId)
                    ->where('normalized_name', $normalized)
                    ->exists();
                if ($exists) {
                    continue;
                }
                DB::table('cirt_quarter_types')->insert([
                    'id' => (string) Str::uuid(),
                    'company_id' => $companyId,
                    'name' => $name,
                    'normalized_name' => $normalized,
                    'is_active' => true,
                    'sort_order' => $sort++,
                    'created_at' => $now,
                    'updated_at' => $now,
                ]);
            }

            $existingLabels = DB::table('cirt_quarters')
                ->where('company_id', $companyId)
                ->whereNotNull('quarter_type')
                ->distinct()
                ->pluck('quarter_type');

            foreach ($existingLabels as $label) {
                $label = trim((string) $label);
                if ($label === '') {
                    continue;
                }
                $normalized = $this->normalize($label);
                $exists = DB::table('cirt_quarter_types')
                    ->where('company_id', $companyId)
                    ->where('normalized_name', $normalized)
                    ->exists();
                if ($exists) {
                    continue;
                }
                DB::table('cirt_quarter_types')->insert([
                    'id' => (string) Str::uuid(),
                    'company_id' => $companyId,
                    'name' => $label,
                    'normalized_name' => $normalized,
                    'is_active' => true,
                    'sort_order' => $sort++,
                    'created_at' => $now,
                    'updated_at' => $now,
                ]);
            }

            $typeMap = DB::table('cirt_quarter_types')
                ->where('company_id', $companyId)
                ->get(['id', 'name', 'normalized_name'])
                ->keyBy('normalized_name');

            $quarters = DB::table('cirt_quarters')
                ->where('company_id', $companyId)
                ->whereNull('quarter_type_id')
                ->get(['id', 'quarter_type']);

            foreach ($quarters as $q) {
                $normalized = $this->normalize((string) $q->quarter_type);
                $type = $typeMap->get($normalized);
                if (! $type) {
                    continue;
                }
                DB::table('cirt_quarters')->where('id', $q->id)->update([
                    'quarter_type_id' => $type->id,
                    'quarter_type' => $type->name,
                    'updated_at' => $now,
                ]);
            }
        }
    }

    private function normalize(string $value): string
    {
        $collapsed = preg_replace('/\s+/u', ' ', trim($value)) ?? '';

        return mb_strtolower($collapsed);
    }
};
