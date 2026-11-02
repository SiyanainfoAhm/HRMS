<?php

namespace App\Console\Commands;

use App\Services\PayrollFieldUsageService;
use Illuminate\Console\Command;

/** Read-only: usage of every Earnings/Deductions field (CIRT-04). */
class PayrollFieldUsage extends Command
{
    protected $signature = 'payroll:field-usage {--company= : Limit to one company id}';

    protected $description = 'Read-only: list Earnings and Deductions fields with rows holding data and last month used';

    public function handle(PayrollFieldUsageService $service): int
    {
        $rows = $service->report($this->option('company') ?: null);
        $this->table(
            ['Group', 'Field', 'Key', 'System', 'Active', 'Rows with data', 'Last used', 'Master values'],
            array_map(fn ($r) => [$r['group'], $r['field'], $r['key'], $r['system'] ? 'Y' : 'N', $r['active'] ? 'Y' : 'N', $r['rows_with_data'], $r['last_used'] ?? '-', $r['master_value_rows']], $rows),
        );

        return self::SUCCESS;
    }
}
