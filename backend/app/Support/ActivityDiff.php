<?php

namespace App\Support;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * THE shared diff helper for the Activity Log. Every module builds its "what changed" the same way:
 * changed fields only, old/new, plain labels, values formatted by type, no ids/timestamps, no secrets,
 * nothing at all when nothing changed. Never a full-record or full-draft dump.
 *
 * A change is {key, label, old, new, type, kind}: `type` is money|hours|percent|date|bool|text, `kind` is
 * "typed" (the operator changed it) or "recalculated" (a derived consequence).
 */
final class ActivityDiff
{
    /** Keys whose values must never be stored or shown. */
    public const SECRET_KEY = '/pass(word)?|pwd|token|secret|hash|credential|api[_-]?key|otp|remember|authorization|bearer|session_version|session/i';

    /** Technical keys that are never a business change. */
    private const TECHNICAL = '/(^|[._])(id|uuid|created_at|updated_at|created_by|updated_by|company_id|version|normalized_name|sort_order|file_path|excel_file_path|logo_url|__.*)$/i';

    /** Reference column => [table, display column] so an id is shown by name. */
    public const REFERENCES = [
        'quarter_id' => ['cirt_quarters', 'quarter_name'],
        'quarter_type_id' => ['cirt_quarter_types', 'name'],
        'division_id' => ['cirt_divisions', 'name'],
        'department_id' => ['cirt_departments', 'name'],
        'designation_id' => ['cirt_designations', 'title'],
        'role_id' => ['cirt_roles', 'name'],
        'manager_id' => ['cirt_users', 'name'],
        'assigned_employee_id' => ['cirt_users', 'name'],
        'employee_id' => ['cirt_users', 'name'],
        'employee_user_id' => ['cirt_users', 'name'],
    ];

    public static function isSecretKey(string $key): bool
    {
        return preg_match(self::SECRET_KEY, $key) === 1;
    }

    /** Recursively drops secret keys and over-long strings from any structure that may be stored. */
    public static function scrub(mixed $value): mixed
    {
        if (is_array($value)) {
            $out = [];
            foreach ($value as $k => $v) {
                if (is_string($k) && self::isSecretKey($k)) continue;
                $out[$k] = self::scrub($v);
            }

            return $out;
        }
        if (is_string($value) && mb_strlen($value) > 300) return mb_substr($value, 0, 300).'…';

        return $value;
    }

    public static function type(string $key, mixed $value = null): string
    {
        $k = Str::snake($key);
        if (is_bool($value) || preg_match('/(^|_)(is|has)_|_(flag|applicable|eligible)$|^include_in|^show_in|^must_/', $k)) return 'bool';
        if (preg_match('/percent|_pct$|percentage/', $k)) return 'percent';
        if (preg_match('/hours?$|_hrs$|night_hours/', $k)) return 'hours';
        if (preg_match('/(^|_)(date|from|to|start|end)(_|$)|effective|_at$|assigned_(from|to)|period_(start|end)/', $k)) return 'date';
        if (preg_match('/amount|rent|salary|pay|arrear|deduction|allowance|electricity|mess|cpf|vpf|lic|tax|bonus|incentive|reimb|rate_per|per_unit|sthir|vahan|fuel|basic|medical|transport|hra|da_|^da$|ctc|level_\d|threshold|ceiling|loan|welfare|society|recovery|charge|fee/', $k)
            && ! preg_match('/_(id|key|code|name|label|type|mode|group|basis)$/', $k)) return 'money';

        return 'text';
    }

    /** Value as shown to people: rupees (grouped), hours, percent (53%), dd/mm/yyyy, Yes/No, text. Null/empty is an em dash. */
    public static function format(mixed $value, string $type = 'text'): string
    {
        if ($value === null || $value === '') return '—';
        if (is_bool($value)) return $value ? 'Yes' : 'No';
        if (is_array($value)) return mb_substr((string) json_encode(self::scrub($value), JSON_UNESCAPED_UNICODE), 0, 300);
        if ($type === 'bool') return in_array(strtolower((string) $value), ['1', 'true', 'yes', 'y', 't'], true) ? 'Yes' : 'No';
        if ($type === 'date') {
            $ts = strtotime((string) $value);

            return $ts ? date('d/m/Y', $ts) : (string) $value;
        }
        if (in_array($type, ['money', 'hours', 'percent'], true) && is_numeric($value)) {
            $n = (float) $value;
            if ($type === 'money') {
                // Rupees, Indian digit grouping (the column header says what it is): 1,923 / 12,34,567 / 54.50
                return self::indian(number_format($n, abs($n - round($n)) < 0.005 ? 0 : 2, '.', ''));
            }
            $text = rtrim(rtrim(number_format($n, 2, '.', ''), '0'), '.');
            $text = $text === '' ? '0' : $text;

            return $type === 'percent' ? $text.'%' : $text; // hours stay a plain number (the label says Hours)
        }
        if (is_numeric($value) && ! preg_match('/^0\d/', (string) $value)) {
            $text = rtrim(rtrim(number_format((float) $value, 2, '.', ''), '0'), '.');

            return $text === '' ? '0' : $text;
        }

        return (string) $value;
    }

    /** "1234567.5" => "12,34,567.5" (Indian digit grouping). */
    public static function indian(string $number): string
    {
        $neg = str_starts_with($number, '-');
        $number = ltrim($number, '-');
        [$int, $dec] = array_pad(explode('.', $number, 2), 2, null);
        $last3 = substr($int, -3);
        $rest = substr($int, 0, -3);
        $int = $rest !== '' && $rest !== false ? preg_replace('/\B(?=(\d{2})+(?!\d))/', ',', $rest).','.$last3 : $last3;

        return ($neg ? '-' : '').$int.($dec !== null ? '.'.$dec : '');
    }

    /**
     * Changed fields only. $opts: labels (key => label), types (key => type), ignore (list of keys),
     * only (list of keys), kind (default kind), resolve (bool, default true: ids shown by name).
     *
     * @param array<string, mixed> $before
     * @param array<string, mixed> $after
     * @param array{labels?: array<string,string>, types?: array<string,string>, ignore?: list<string>, only?: list<string>, kind?: string, resolve?: bool} $opts
     * @return list<array{key: string, label: string, old: mixed, new: mixed, type: string, kind: string}>
     */
    public static function diff(array $before, array $after, array $opts = []): array
    {
        $labels = $opts['labels'] ?? [];
        $types = $opts['types'] ?? [];
        $ignore = array_flip($opts['ignore'] ?? []);
        $only = isset($opts['only']) ? array_flip($opts['only']) : null;
        $resolve = $opts['resolve'] ?? true;
        $out = [];
        foreach (array_unique([...array_keys($before), ...array_keys($after)]) as $key) {
            if (! is_string($key) || isset($ignore[$key])) continue;
            if ($only !== null && ! isset($only[$key])) continue;
            if (self::isSecretKey($key)) continue;
            $isRef = $resolve && isset(self::REFERENCES[$key]);
            if (! $isRef && preg_match(self::TECHNICAL, $key)) continue;
            $old = $before[$key] ?? null;
            $new = $after[$key] ?? null;
            if (self::same($old, $new)) continue;
            $type = $types[$key] ?? ($isRef ? 'text' : self::type($key, $new ?? $old));
            if ($isRef) {
                $old = self::reference($key, $old);
                $new = self::reference($key, $new);
            }
            $out[] = [
                'key' => $key,
                'label' => $labels[$key] ?? self::label($key),
                'old' => self::compact($old),
                'new' => self::compact($new),
                'type' => $type,
                'kind' => $opts['kind'] ?? 'typed',
            ];
        }

        return $out;
    }

    /** Every non-empty property of a new/removed record, as changes from/to nothing (creates and deletes). */
    public static function snapshotAsChanges(array $row, bool $created, array $opts = []): array
    {
        $empty = array_fill_keys(array_keys($row), null);

        return $created ? self::diff($empty, $row, $opts) : self::diff($row, $empty, $opts);
    }

    public static function label(string $key): string
    {
        $key = preg_replace('/_id$/', '', $key) ?? $key;

        return Str::headline($key);
    }

    private static function same(mixed $a, mixed $b): bool
    {
        if (is_numeric($a) && is_numeric($b)) return abs((float) $a - (float) $b) < 0.0001;
        if (is_bool($a) || is_bool($b)) return self::boolish($a) === self::boolish($b);
        if (is_array($a) || is_array($b)) return json_encode($a) === json_encode($b);
        if (($a === null || $a === '') && ($b === null || $b === '')) return true;

        return $a === $b || (string) $a === (string) $b;
    }

    private static function boolish(mixed $v): bool
    {
        return in_array(is_string($v) ? strtolower($v) : $v, [true, 1, '1', 'true', 't', 'yes'], true);
    }

    private static function compact(mixed $v): mixed
    {
        if (is_array($v)) return self::scrub($v);

        return is_string($v) && mb_strlen($v) > 300 ? mb_substr($v, 0, 300).'…' : $v;
    }

    private static array $referenceCache = [];

    /** An id shown by its name ("Quarter A-12", "Roads Division"); unknown ids stay as they are. */
    public static function reference(string $key, mixed $id): mixed
    {
        if ($id === null || $id === '' || ! isset(self::REFERENCES[$key])) return $id;
        $ck = $key.'|'.$id;
        if (array_key_exists($ck, self::$referenceCache)) return self::$referenceCache[$ck];
        [$table, $col] = self::REFERENCES[$key];
        try {
            $name = DB::table($table)->where('id', $id)->value($col);
        } catch (\Throwable) {
            $name = null;
        }

        return self::$referenceCache[$ck] = ($name ?? $id);
    }

    public static function forgetReferences(): void
    {
        self::$referenceCache = [];
    }
}
