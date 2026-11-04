<?php

namespace App\Console\Commands;

use App\Support\SchemaVersion;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Read-only post-deploy verification. Exit code 0 only when the database matches
 * the release and no data condition that blocks payroll was found.
 */
class PayrollSchemaCheck extends Command
{
    protected $signature = 'payroll:schema-check';

    protected $description = 'Read-only: verify the database schema and payroll data conditions after a deployment';

    public function handle(): int
    {
        $failures = [];
        $warnings = [];

        $schema = SchemaVersion::status();
        $this->line(($schema['ok'] ? '[ok]   ' : '[FAIL] ').$schema['message']);
        if (! $schema['ok']) $failures[] = $schema['message'];

        $tz = (string) config('app.timezone');
        if ($tz !== 'Asia/Kolkata') {
            $failures[] = "APP_TIMEZONE is '{$tz}', not Asia/Kolkata: quarter assignment and effective dates use the server date and fall on the wrong day. Set APP_TIMEZONE=Asia/Kolkata in backend/.env.";
        }

        // Production hygiene (warnings, never failures): debug mode leaks stack traces and a debug log level fills the disk.
        if (config('app.debug')) $warnings[] = 'APP_DEBUG=true. Set APP_DEBUG=false in backend/.env on the live server.';
        if (strtolower((string) config('logging.channels.single.level', config('logging.channels.stack.level', 'debug'))) === 'debug' || strtolower((string) env('LOG_LEVEL', 'debug')) === 'debug') {
            $warnings[] = 'LOG_LEVEL=debug. Set LOG_LEVEL=warning (or error) in backend/.env on the live server.';
        }
        if (config('logging.payroll_trace')) $warnings[] = 'PAYROLL_TRACE=true writes one log line per employee and month. Remove it unless you are diagnosing.';
        // The Activity Log field-diff columns (migration 2026_11_03_150000) are optional for the code but needed for stored diffs.
        foreach (['cirt_activity_log_entries' => ['summary', 'subject'], 'cirt_activity_log_details' => ['diff', 'change_kind']] as $table => $cols) {
            foreach ($cols as $col) {
                if (Schema::hasTable($table) && ! Schema::hasColumn($table, $col)) {
                    $warnings[] = "Activity Log column {$table}.{$col} is missing: run php artisan migrate --force (changes are logged without their stored diff until then).";
                }
            }
        }

        if ($schema['ok']) {
            $sameQuarter = DB::select('SELECT employee_id, quarter_id, count(*) AS c FROM cirt_quarter_assignments WHERE assigned_to IS NULL GROUP BY company_id, employee_id, quarter_id HAVING count(*) > 1');
            if ($sameQuarter !== []) {
                $failures[] = count($sameQuarter).' employee(s) have repeated open assignments to the same quarter. Run: php artisan payroll:repair-data --apply';
            }
            $perEmployee = DB::select('SELECT employee_id, count(*) AS c FROM cirt_quarter_assignments WHERE assigned_to IS NULL GROUP BY company_id, employee_id HAVING count(DISTINCT quarter_id) > 1');
            if ($perEmployee !== []) {
                $failures[] = count($perEmployee).' employee(s) are open on more than one quarter. This needs a human decision: close the wrong assignment in Settings > Quarters.';
            }
            $perQuarter = DB::select('SELECT quarter_id, count(*) AS c FROM cirt_quarter_assignments WHERE assigned_to IS NULL GROUP BY company_id, quarter_id HAVING count(DISTINCT employee_id) > 1');
            if ($perQuarter !== []) {
                $failures[] = count($perQuarter).' quarter(s) are open for more than one employee. This needs a human decision: close the wrong assignment in Settings > Quarters.';
            }
            $noTariff = DB::table('cirt_electricity_tariffs')->where('is_active', true)->count() === 0;
            if ($noTariff) $warnings[] = 'No active electricity tariff exists; employees with Elec. units cannot be billed.';
            $indexes = DB::select("SELECT indexname FROM pg_indexes WHERE tablename = 'cirt_quarter_assignments' AND indexname LIKE 'cirt_quarter_assignment_one_open_%'");
            if (count($indexes) < 2) $warnings[] = 'The one-open-assignment unique indexes are not both present yet (created once ambiguous assignments are resolved).';
        }

        foreach ($warnings as $w) $this->warn('[warn] '.$w);
        foreach ($failures as $f) $this->error('[FAIL] '.$f);
        $this->line($failures === [] ? 'Schema check passed.' : 'Schema check FAILED ('.count($failures).' problem(s)).');

        return $failures === [] ? self::SUCCESS : self::FAILURE;
    }
}
