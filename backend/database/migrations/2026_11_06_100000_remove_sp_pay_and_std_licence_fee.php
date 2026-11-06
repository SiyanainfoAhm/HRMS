<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * CIRT: "Special Pay" (SP Pay, spPayPaid / sp_pay_paid) and "Std Licence Fee" (stdLicenceFee / std_licence_fee_amount) are
 * not used. Quarter rent is the Quarter Rent line and every special amount is in Special Allowance.
 *
 * BACK UP THE DATABASE BEFORE RUNNING THIS. It drops columns and rewrites JSON payloads.
 *
 * The migration refuses to run (and changes nothing) when any of the two fields still carries a non-zero value:
 *   - the typed columns of cirt_monthly_payroll, cirt_payroll_master and cirt_payroll_master_history,
 *   - any stored payload key (draft rows, payroll audits, run revisions, draft audits),
 *   - any employee value stored against the two field definitions.
 * Move such amounts to Special Allowance first, then run it again.
 *
 * Activity-log rows (cirt_activity_logs / cirt_activity_log_details) and the "changes" paths inside draft audit entries are
 * history of what was once saved; they are not rewritten.
 */
return new class extends Migration
{
    /** Exact payload keys that belong to the two retired fields. */
    private const KEYS = [
        'stdLicenceFee', 'std_licence_fee', 'std_licence_fee_amount', 'std_licence_fee_default', 'stdLicenceFeeDefault',
        'standard_licence_fee', 'standardLicenceFee',
        'spPay', 'spPayPaid', 'spPayActual', 'sp_pay', 'sp_pay_paid', 'sp_pay_actual',
    ];

    /** Field keys of the two retired field definitions (also the CPF basis list entry). */
    private const FIELD_KEYS = ['sp_pay', 'standard_licence_fee'];

    /** table => [json columns that can carry the keys] */
    private const JSON_COLUMNS = [
        'cirt_payroll_draft_employees' => ['row_payload'],
        'cirt_monthly_payroll_audits' => ['before_payload', 'after_payload'],
        'cirt_payroll_run_revisions' => ['monthly_rows'],
        'cirt_payroll_draft_audits' => ['employee_snapshot'],
        'cirt_payroll_calculation_settings' => ['cpf_basis_field_keys'],
        'cirt_payroll_master' => ['cpf_basis_field_keys_override'],
        'cirt_payroll_master_history' => ['cpf_basis_field_keys_override'],
    ];

    /** table => columns dropped */
    private const DROP_COLUMNS = [
        'cirt_monthly_payroll' => ['sp_pay_actual', 'sp_pay_paid', 'std_licence_fee_amount'],
        'cirt_payroll_master' => ['standard_licence_fee', 'std_licence_fee_default'],
        'cirt_payroll_master_history' => ['standard_licence_fee', 'std_licence_fee_default'],
    ];

    public function up(): void
    {
        // 1. Refuse to run while anything non-zero exists.
        $problems = $this->nonZeroValues();
        if ($problems !== []) {
            throw new RuntimeException(
                "Special Pay / Std Licence Fee still carry values; nothing was changed. Move them to Special Allowance first:\n - "
                .implode("\n - ", array_slice($problems, 0, 50)).(count($problems) > 50 ? "\n - ... and ".(count($problems) - 50).' more' : '')
            );
        }

        DB::transaction(function (): void {
            // 2. Field definitions and any (zero / empty) stored values.
            if (Schema::hasTable('cirt_payroll_field_values')) {
                DB::table('cirt_payroll_field_values')->whereIn('field_key', self::FIELD_KEYS)->delete();
            }
            if (Schema::hasTable('cirt_payroll_field_definitions')) {
                DB::table('cirt_payroll_field_definitions')->whereIn('field_key', self::FIELD_KEYS)->delete();
            }

            // 3. Strip the keys from the JSON payloads.
            foreach (self::JSON_COLUMNS as $table => $columns) {
                foreach ($columns as $column) {
                    $this->stripColumn($table, $column);
                }
            }
        });

        // 4. Drop the columns.
        foreach (self::DROP_COLUMNS as $table => $columns) {
            if (! Schema::hasTable($table)) continue;
            $present = array_values(array_filter($columns, fn (string $c): bool => Schema::hasColumn($table, $c)));
            if ($present !== []) {
                Schema::table($table, function ($t) use ($present): void {
                    $t->dropColumn($present);
                });
            }
        }
    }

    /** Structure only: the amounts are gone (they were all zero when this ran), so the columns come back at 0 / NULL. */
    public function down(): void
    {
        $restore = [
            'cirt_monthly_payroll' => ['sp_pay_actual' => 0, 'sp_pay_paid' => 0, 'std_licence_fee_amount' => 0],
            'cirt_payroll_master' => ['standard_licence_fee' => null, 'std_licence_fee_default' => 0],
            'cirt_payroll_master_history' => ['standard_licence_fee' => null, 'std_licence_fee_default' => 0],
        ];
        foreach ($restore as $table => $columns) {
            if (! Schema::hasTable($table)) continue;
            foreach ($columns as $column => $default) {
                if (Schema::hasColumn($table, $column)) continue;
                Schema::table($table, function ($t) use ($column, $default): void {
                    $c = $t->decimal($column, 12, 2)->nullable();
                    if ($default !== null) $c->default($default);
                });
            }
        }
    }

    /** @return list<string> one line per non-zero value found */
    private function nonZeroValues(): array
    {
        $found = [];
        foreach (self::DROP_COLUMNS as $table => $columns) {
            if (! Schema::hasTable($table)) continue;
            foreach ($columns as $column) {
                if (! Schema::hasColumn($table, $column)) continue;
                $n = DB::table($table)->whereNotNull($column)->where($column, '<>', 0)->count();
                if ($n > 0) $found[] = "{$table}.{$column}: {$n} non-zero row(s)";
            }
        }
        if (Schema::hasTable('cirt_payroll_field_values')) {
            foreach (DB::table('cirt_payroll_field_values')->whereIn('field_key', self::FIELD_KEYS)->get() as $row) {
                $v = trim((string) ($row->field_value ?? ''));
                if ($v !== '' && (! is_numeric($v) || (float) $v != 0.0)) $found[] = "cirt_payroll_field_values {$row->field_key} master {$row->payroll_master_id}: '{$v}'";
            }
        }
        foreach (self::JSON_COLUMNS as $table => $columns) {
            if (! Schema::hasTable($table)) continue;
            foreach ($columns as $column) {
                if (! Schema::hasColumn($table, $column)) continue;
                foreach ($this->rowsWithKeys($table, $column) as $row) {
                    $payload = json_decode((string) $row->payload);
                    if ($payload === null) continue;
                    foreach ($this->nonZeroPaths($payload, '') as $path) $found[] = "{$table}.{$column} row {$row->id}: {$path}";
                }
            }
        }

        return $found;
    }

    /** Rows of a JSON column whose text mentions one of the retired keys (the cheap pre-filter). */
    private function rowsWithKeys(string $table, string $column): \Generator
    {
        $pattern = '(stdLicenceFee|std_licence_fee|standard_licence_fee|standardLicenceFee|spPay|sp_pay)';
        $query = DB::table($table)->selectRaw("id, \"{$column}\"::text as payload")->whereRaw("\"{$column}\"::text ~ ?", [$pattern]);
        foreach ($query->cursor() as $row) yield $row;
    }

    /** @return list<string> */
    private function nonZeroPaths(mixed $node, string $path): array
    {
        $out = [];
        if (is_object($node)) $node = (array) $node;
        if (! is_array($node)) return $out;
        foreach ($node as $key => $value) {
            $p = $path === '' ? (string) $key : $path.'.'.$key;
            if (in_array((string) $key, self::KEYS, true) && $this->hasValue($value)) {
                $out[] = $p.' = '.json_encode($value);
            }
            $out = [...$out, ...$this->nonZeroPaths($value, $p)];
        }
        // A CPF basis list may carry the retired field key; a list entry is a setting, not a value.
        return $out;
    }

    private function hasValue(mixed $value): bool
    {
        if ($value === null || $value === '' || $value === false || $value === []) return false;
        if (is_object($value)) return (array) $value !== [];
        if (is_numeric($value)) return (float) $value != 0.0;

        return true;
    }

    private function stripColumn(string $table, string $column): void
    {
        if (! Schema::hasTable($table) || ! Schema::hasColumn($table, $column)) return;
        $ids = [];
        foreach ($this->rowsWithKeys($table, $column) as $row) $ids[] = $row->id;
        foreach (array_chunk($ids, 200) as $chunk) {
            foreach (DB::table($table)->selectRaw("id, \"{$column}\"::text as payload")->whereIn('id', $chunk)->get() as $row) {
                $flags = JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRESERVE_ZERO_FRACTION;
                // Objects stay objects, so an empty {} is not turned into [].
                $original = json_decode((string) $row->payload);
                if ($original === null) continue;
                $before = json_encode($original, $flags);
                $new = json_encode($this->strip(json_decode((string) $row->payload)), $flags); // strip() edits in place: work on a second copy
                if ($new !== false && $new !== $before) {
                    DB::table($table)->where('id', $row->id)->update([$column => $new]);
                }
            }
        }
    }

    private function strip(mixed $node): mixed
    {
        if (is_object($node)) {
            foreach (array_keys(get_object_vars($node)) as $key) {
                if (in_array((string) $key, self::KEYS, true)) {
                    unset($node->{$key});
                } else {
                    $node->{$key} = $this->strip($node->{$key});
                }
            }

            return $node;
        }
        if (is_array($node)) {
            // A list that names a retired field (CPF basis keys) loses that entry; the list stays a list.
            $isList = array_is_list($node);
            $node = array_map(fn ($v) => $this->strip($v), $node);
            if ($isList) {
                $node = array_values(array_filter($node, fn ($v) => ! (is_string($v) && in_array($v, self::FIELD_KEYS, true))));
            }

            return $node;
        }

        return $node;
    }
};
