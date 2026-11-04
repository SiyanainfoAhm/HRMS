<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;

/**
 * Removes the two test/dummy quarters ("Q1- 400" Type I Rs 20,000 and "Quarter 2"
 * Type II Rs 10,000) ONLY when they are inactive and nothing references them
 * (no assignment history, no Payroll Master row, no monthly payroll row).
 * A quarter with any link is left untouched (inactive) and reported in the log.
 */
return new class extends Migration
{
    /** @var list<array{name: string, type: string, rent: float}> */
    private array $dummies = [
        ['name' => 'Q1- 400', 'type' => 'Type I', 'rent' => 20000.0],
        ['name' => 'Quarter 2', 'type' => 'Type II', 'rent' => 10000.0],
    ];

    public function up(): void
    {
        if (! Schema::hasTable('cirt_quarters')) {
            return;
        }

        foreach ($this->dummies as $dummy) {
            $rows = DB::table('cirt_quarters')
                ->where('quarter_name', $dummy['name'])
                ->where('quarter_type', $dummy['type'])
                ->where('monthly_rent', $dummy['rent'])
                ->where('status', 'inactive')
                ->get();

            foreach ($rows as $quarter) {
                $links = [];
                foreach (['cirt_quarter_assignments', 'cirt_payroll_master', 'cirt_monthly_payroll'] as $table) {
                    if (Schema::hasTable($table) && DB::table($table)->where('quarter_id', $quarter->id)->exists()) {
                        $links[] = $table;
                    }
                }
                if ($quarter->assigned_employee_id) {
                    $links[] = 'cirt_quarters.assigned_employee_id';
                }

                if ($links !== []) {
                    Log::warning("Dummy quarter '{$dummy['name']}' kept (inactive): linked via ".implode(', ', $links).'.');

                    continue;
                }

                DB::table('cirt_quarters')->where('id', $quarter->id)->delete();
                Log::info("Dummy quarter '{$dummy['name']}' deleted.");
            }
        }
    }

    public function down(): void
    {
        // Deleted test data is intentionally not restored.
    }
};
