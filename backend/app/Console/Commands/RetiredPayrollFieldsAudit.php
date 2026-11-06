<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Read-only. Reports every non-zero value of the two retired fields, "Special Pay" (SP Pay) and "Std Licence Fee", in any
 * draft, generated payroll, Payroll Master (and its history), payroll audit, run revision or stored field value.
 *
 * Run it on a database BEFORE migration 2026_11_06_100000_remove_sp_pay_and_std_licence_fee: the exit code is 1 and the
 * migration refuses to run while anything is listed. Move such amounts to Special Allowance first.
 */
class RetiredPayrollFieldsAudit extends Command
{
    protected $signature = 'payroll:retired-fields-audit';
    protected $description = 'Read-only: list non-zero Special Pay / Std Licence Fee values (must be empty before the removal migration)';

    /** Exact payload keys of the two retired fields. */
    public const KEYS = [
        'stdLicenceFee', 'std_licence_fee', 'std_licence_fee_amount', 'std_licence_fee_default', 'stdLicenceFeeDefault',
        'standard_licence_fee', 'standardLicenceFee',
        'spPay', 'spPayPaid', 'spPayActual', 'sp_pay', 'sp_pay_paid', 'sp_pay_actual',
    ];

    private const COLUMNS = [
        'cirt_monthly_payroll' => ['sp_pay_actual', 'sp_pay_paid', 'std_licence_fee_amount'],
        'cirt_payroll_master' => ['standard_licence_fee', 'std_licence_fee_default'],
        'cirt_payroll_master_history' => ['standard_licence_fee', 'std_licence_fee_default'],
    ];

    private const JSON_COLUMNS = [
        'cirt_payroll_draft_employees' => ['row_payload'],
        'cirt_monthly_payroll_audits' => ['before_payload', 'after_payload'],
        'cirt_payroll_run_revisions' => ['monthly_rows'],
        'cirt_payroll_draft_audits' => ['employee_snapshot'],
    ];

    /** @return list<string> paths of retired keys that carry a value other than 0 / empty */
    public static function nonZeroPaths(mixed $node, string $path = ''): array
    {
        $out = [];
        if (is_object($node)) $node = (array) $node;
        if (! is_array($node)) return $out;
        foreach ($node as $key => $value) {
            $p = $path === '' ? (string) $key : $path.'.'.$key;
            if (in_array((string) $key, self::KEYS, true) && self::hasValue($value)) $out[] = $p.' = '.json_encode($value);
            $out = [...$out, ...self::nonZeroPaths($value, $p)];
        }

        return $out;
    }

    private static function hasValue(mixed $value): bool
    {
        if ($value === null || $value === '' || $value === false || $value === []) return false;
        if (is_object($value)) return (array) $value !== [];
        if (is_numeric($value)) return (float) $value != 0.0;

        return true;
    }

    public function handle(): int
    {
        $found = [];
        $checked = 0;
        foreach (self::COLUMNS as $table => $columns) {
            if (! Schema::hasTable($table)) continue;
            foreach ($columns as $column) {
                if (! Schema::hasColumn($table, $column)) { $this->line("{$table}.{$column}: column already dropped"); continue; }
                $checked++;
                $n = DB::table($table)->whereNotNull($column)->where($column, '<>', 0)->count();
                $total = DB::table($table)->count();
                $this->line("{$table}.{$column}: {$total} rows, {$n} non-zero");
                if ($n > 0) {
                    foreach (DB::table($table)->whereNotNull($column)->where($column, '<>', 0)->limit(100)->get() as $row) {
                        $found[] = "{$table}.{$column} = {$row->{$column}} (row ".($row->id ?? '?').')';
                    }
                }
            }
        }
        if (Schema::hasTable('cirt_payroll_field_values')) {
            foreach (DB::table('cirt_payroll_field_values')->whereIn('field_key', ['sp_pay', 'standard_licence_fee'])->get() as $row) {
                $v = trim((string) ($row->field_value ?? ''));
                if ($v !== '' && (! is_numeric($v) || (float) $v != 0.0)) $found[] = "cirt_payroll_field_values {$row->field_key}, master {$row->payroll_master_id}: '{$v}'";
            }
        }
        $pattern = '(stdLicenceFee|std_licence_fee|standard_licence_fee|standardLicenceFee|spPay|sp_pay)';
        foreach (self::JSON_COLUMNS as $table => $columns) {
            if (! Schema::hasTable($table)) continue;
            foreach ($columns as $column) {
                if (! Schema::hasColumn($table, $column)) continue;
                $rows = 0;
                foreach (DB::table($table)->selectRaw("id, \"{$column}\"::text as payload")->whereRaw("\"{$column}\"::text ~ ?", [$pattern])->cursor() as $row) {
                    $rows++;
                    $payload = json_decode((string) $row->payload);
                    foreach (self::nonZeroPaths($payload) as $path) $found[] = "{$table}.{$column} row {$row->id}: {$path}";
                }
                $this->line("{$table}.{$column}: {$rows} row(s) mention a retired key");
            }
        }

        if ($found === []) {
            $this->info('No non-zero Special Pay / Std Licence Fee value anywhere. The removal migration can run.');

            return self::SUCCESS;
        }
        $this->error(count($found).' non-zero value(s). Do NOT run the removal migration; move these to Special Allowance first:');
        foreach (array_slice($found, 0, 200) as $line) $this->line(' - '.$line);

        return self::FAILURE;
    }
}
