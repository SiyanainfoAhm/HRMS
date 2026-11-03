<?php

namespace App\Support;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Which requests are audited as "one record per action, with field-level old -> new", and how a request's
 * before/after state is read. A spec names the table, the plain labels the screens use, and the module.
 * ActivityLogService turns a matched request into ONE Activity Log entry through ActivityDiff.
 */
final class ActivityAudit
{
    /** @var array<string, array<string, mixed>> */
    public const SPECS = [
        'division' => [
            'route' => 'settings/divisions', 'table' => 'cirt_divisions', 'entity' => 'Division', 'module' => 'Settings', 'name' => 'name',
            'labels' => ['name' => 'Division name', 'description' => 'Description', 'is_active' => 'Active'],
        ],
        'department' => [
            'route' => 'settings/departments', 'table' => 'cirt_departments', 'entity' => 'Department', 'module' => 'Settings', 'name' => 'name',
            'labels' => ['name' => 'Department name', 'description' => 'Description', 'division_id' => 'Division', 'is_active' => 'Active'],
        ],
        'designation' => [
            'route' => 'settings/designations', 'table' => 'cirt_designations', 'entity' => 'Designation', 'module' => 'Settings', 'name' => 'title',
            'labels' => ['title' => 'Designation title', 'level' => 'Level', 'is_active' => 'Active'],
        ],
        'role' => [
            'route' => 'settings/roles', 'table' => 'cirt_roles', 'entity' => 'Role', 'module' => 'Users', 'name' => 'name',
            'labels' => ['name' => 'Role name', 'role_key' => 'Role key', 'description' => 'Description', 'is_default' => 'Default role', 'is_active' => 'Active'],
        ],
        'quarter' => [
            'route' => 'settings/quarters', 'table' => 'cirt_quarters', 'entity' => 'Quarter', 'module' => 'Quarters', 'name' => 'quarter_name',
            'ignore' => ['quarter_type_id'],
            'labels' => ['quarter_name' => 'Quarter name', 'quarter_type' => 'Quarter type', 'monthly_rent' => 'Monthly rent', 'status' => 'Status',
                'assigned_employee_id' => 'Assigned to', 'assigned_from' => 'Assigned from', 'assigned_to' => 'Assigned until'],
            'types' => ['monthly_rent' => 'money'],
        ],
        'quarter_type' => [
            'route' => 'settings/quarter-types', 'table' => 'cirt_quarter_types', 'entity' => 'Quarter type', 'module' => 'Quarters', 'name' => 'name',
            'labels' => ['name' => 'Quarter type name', 'is_active' => 'Active'],
        ],
        'night_allowance' => [
            'route' => 'settings/night-allowance-rates', 'table' => 'cirt_night_allowance_rates', 'entity' => 'Night allowance rate', 'module' => 'Settings',
            'nameFn' => 'nightName', 'ignore' => ['rate_per_hour'],
            'labels' => ['slab_no' => 'Slab', 'pay_level' => 'Pay level', 'rate_per_duty' => 'Rate per duty (8 hours)', 'effective_from' => 'Effective from', 'is_active' => 'Active'],
            'types' => ['rate_per_duty' => 'money', 'slab_no' => 'text', 'pay_level' => 'text'],
        ],
        'electricity_tariff' => [
            'route' => 'settings/electricity-tariffs', 'table' => 'cirt_electricity_tariffs', 'entity' => 'Electricity tariff', 'module' => 'Settings',
            'nameFn' => 'tariffName', 'extra' => 'tariffExtras',
            'labels' => ['effective_from' => 'Effective from', 'sthir_aakar' => 'Fixed charge (Sthir Aakar)', 'vahan_aakar_per_unit' => 'Vahan Aakar per unit',
                'fuel_charge' => 'Fuel charge', 'duty_percentage' => 'Electricity duty', 'is_active' => 'Active', 'slabs' => 'Unit slabs'],
            'types' => ['sthir_aakar' => 'money', 'vahan_aakar_per_unit' => 'money', 'fuel_charge' => 'money', 'duty_percentage' => 'percent', 'slabs' => 'text'],
        ],
        'payroll_field' => [
            'route' => 'settings/payroll-fields', 'table' => 'cirt_payroll_field_definitions', 'entity' => 'Payroll field', 'module' => 'Settings', 'name' => 'field_label',
            'ignore' => ['is_system', 'calculation_type', 'default_value', 'dropdown_options'],
            'labels' => ['field_label' => 'Field label', 'field_key' => 'Field key', 'field_group' => 'Group (earning / deduction / info)', 'field_type' => 'Field type',
                'is_required' => 'Required', 'show_in_payroll_master' => 'Show in Payroll Master', 'show_in_run_payroll' => 'Show in Run Payroll',
                'show_in_salary_slip' => 'Show in salary slip', 'include_in_total_earnings' => 'Include in total earnings',
                'include_in_total_deductions' => 'Include in total deductions', 'is_active' => 'Active', 'display_order' => 'Order'],
            'types' => ['display_order' => 'text', 'field_group' => 'text', 'field_type' => 'text'],
            'createShow' => ['field_key', 'field_label', 'field_group', 'field_type', 'include_in_total_earnings', 'include_in_total_deductions',
                'show_in_payroll_master', 'show_in_run_payroll', 'show_in_salary_slip', 'is_required', 'is_active', 'display_order'],
        ],
        'calculation' => [
            'route' => 'settings/payroll-calculation-settings', 'table' => 'cirt_payroll_calculation_settings', 'where' => 'company', 'entity' => 'Payroll calculation settings',
            'module' => 'Settings', 'singleton' => true,
            'labels' => ['cpf_percentage' => 'CPF %', 'cpf_basis_field_keys' => 'CPF basis fields', 'cpf_calculation_mode' => 'CPF calculation mode',
                'cpf_fixed_amount' => 'CPF fixed amount', 'electricity_unit_rate' => 'Electricity unit rate', 'night_allowance_basic_ceiling' => 'Night allowance basic-pay ceiling'],
            'types' => ['cpf_percentage' => 'percent', 'electricity_unit_rate' => 'money', 'night_allowance_basic_ceiling' => 'money', 'cpf_fixed_amount' => 'money',
                'cpf_basis_field_keys' => 'text', 'cpf_calculation_mode' => 'text'],
        ],
        'company' => [
            'route' => 'company/(?:me|setup)', 'table' => 'cirt_institute', 'where' => 'institute', 'entity' => 'Company settings', 'module' => 'Settings', 'singleton' => true,
            'ignore' => ['logo_url', 'code'],
            'labels' => ['default_da_percent' => 'DA %', 'default_hra_percent' => 'HRA %', 'transport_allowance_level_9_plus' => 'Transport allowance (Pay Level 9 and above)',
                'transport_allowance_level_3_8' => 'Transport allowance (Pay Level 3-8)', 'transport_allowance_level_1_2' => 'Transport allowance (Pay Level 1-2)',
                'transport_allowance_level_1_2_enhanced' => 'Transport allowance (Pay Level 1-2, enhanced)', 'transport_allowance_basic_threshold' => 'Transport allowance basic-pay threshold',
                'transport_allowance_high_min_level' => 'Transport allowance: lowest "high" Pay Level', 'transport_allowance_mid_min_level' => 'Transport allowance: lowest "mid" Pay Level',
                'professional_tax_annual' => 'Professional tax (annual)', 'professional_tax_monthly' => 'Professional tax (monthly)'],
            'types' => ['default_da_percent' => 'percent', 'default_hra_percent' => 'percent', 'transport_allowance_basic_threshold' => 'money',
                'transport_allowance_high_min_level' => 'text', 'transport_allowance_mid_min_level' => 'text'],
            'effectiveInput' => ['payroll_revision_effective_from', 'payrollRevisionEffectiveFrom'],
        ],
        'payroll_period' => [
            'route' => 'payroll/periods', 'table' => 'cirt_payroll_periods', 'entity' => 'Payroll period', 'module' => 'Payroll', 'name' => 'period_name',
            'ignore' => ['excel_file_path'],
            'labels' => ['period_name' => 'Period', 'period_start' => 'Period start', 'period_end' => 'Period end', 'is_locked' => 'Locked'],
        ],
        'user' => [
            'route' => 'users', 'table' => 'cirt_users', 'entity' => 'User', 'module' => 'Users', 'name' => 'name',
            'only' => ['name', 'email', 'employee_code', 'role', 'employment_status', 'designation_id', 'department_id', 'division_id', 'designation', 'government_pay_level', 'date_of_joining', 'date_of_leaving'],
            'labels' => ['name' => 'Name', 'email' => 'Login email', 'employee_code' => 'Employee code', 'role' => 'Role', 'employment_status' => 'Employment status',
                'designation_id' => 'Designation', 'department_id' => 'Department', 'division_id' => 'Division', 'designation' => 'Designation', 'government_pay_level' => 'Pay level',
                'date_of_joining' => 'Date of joining', 'date_of_leaving' => 'Date of leaving'],
            'types' => ['government_pay_level' => 'text', 'role' => 'text', 'employment_status' => 'text'],
            'employee' => true,
        ],
        'employee' => [
            'route' => 'employees', 'table' => 'cirt_users', 'entity' => 'Employee', 'module' => 'Master', 'name' => 'name',
            'only' => ['name', 'email', 'employee_code', 'role', 'employment_status', 'designation_id', 'department_id', 'division_id', 'designation', 'government_pay_level', 'date_of_joining', 'date_of_leaving'],
            'labels' => ['name' => 'Name', 'email' => 'Email', 'employee_code' => 'Employee code', 'role' => 'Role', 'employment_status' => 'Employment status',
                'designation_id' => 'Designation', 'department_id' => 'Department', 'division_id' => 'Division', 'designation' => 'Designation', 'government_pay_level' => 'Pay level',
                'date_of_joining' => 'Date of joining', 'date_of_leaving' => 'Date of leaving'],
            'types' => ['government_pay_level' => 'text', 'role' => 'text', 'employment_status' => 'text'],
            'employee' => true,
        ],
    ];

    private const VERBS = [
        'deactivate' => 'deactivated', 'activate' => 'activated', 'assign' => 'assigned', 'unassign' => 'released',
    ];

    /**
     * @return array{spec: string, id: ?string, verb: string}|null
     */
    public static function match(string $method, string $route): ?array
    {
        $method = strtoupper($method);
        if (! in_array($method, ['POST', 'PUT', 'PATCH', 'DELETE'], true)) return null;
        $route = preg_replace('~^api/v1/~', '', ltrim($route, '/')) ?? $route;
        foreach (self::SPECS as $key => $spec) {
            $re = '~^'.$spec['route'].'(?:/([0-9a-f-]{36}))?(?:/(deactivate|activate|assign|unassign|preview))?$~i';
            if (! preg_match($re, $route, $m)) continue;
            $id = ($m[1] ?? '') !== '' ? $m[1] : null;
            $suffix = strtolower($m[2] ?? '');
            if ($suffix === 'preview') return null;
            if ($key === 'user' && $id === null && $method !== 'POST') return null;
            if (! empty($spec['singleton'])) return ['spec' => $key, 'id' => null, 'verb' => 'updated'];
            if ($suffix !== '') return ['spec' => $key, 'id' => $id, 'verb' => self::VERBS[$suffix]];
            $verb = match (true) {
                $method === 'DELETE' => 'deleted',
                $method === 'POST' && $id === null => 'created',
                default => 'updated',
            };

            return ['spec' => $key, 'id' => $id, 'verb' => $verb];
        }

        return null;
    }

    /** Current stored values of the audited record (scalar columns, secrets removed), or null when it does not exist. */
    public static function snapshot(array $match, ?string $companyId, ?string $newestSince = null): ?array
    {
        $spec = self::SPECS[$match['spec']];
        if (! Schema::hasTable($spec['table'])) return null;
        $q = DB::table($spec['table']);
        if (($spec['where'] ?? null) === 'company') {
            if (! $companyId) return null;
            $q->where('company_id', $companyId);
        } elseif (($spec['where'] ?? null) === 'institute') {
            if (! $companyId) return null;
            $q->where('id', $companyId);
        } elseif ($match['id'] !== null) {
            $q->where('id', $match['id']);
            if ($companyId && Schema::hasColumn($spec['table'], 'company_id')) $q->where('company_id', $companyId);
        } elseif ($newestSince !== null) {
            if ($companyId && Schema::hasColumn($spec['table'], 'company_id')) $q->where('company_id', $companyId);
            $order = Schema::hasColumn($spec['table'], 'created_at') ? 'created_at' : null;
            if ($order === null) return null;
            $q->where('created_at', '>=', $newestSince)->orderByDesc('created_at');
        } else {
            return null;
        }
        $row = $q->first();
        if (! $row) return null;
        $out = [];
        foreach ((array) $row as $key => $value) {
            if (ActivityDiff::isSecretKey((string) $key)) continue;
            if (is_scalar($value) || $value === null) $out[$key] = $value;
        }
        if (isset($spec['extra'])) $out = array_merge($out, self::{$spec['extra']}($out));

        return $out;
    }

    public static function recordName(array $match, ?array $row): string
    {
        $spec = self::SPECS[$match['spec']];
        if ($row === null) return $spec['entity'];
        if (isset($spec['nameFn'])) return (string) self::{$spec['nameFn']}($row);
        $name = $spec['name'] ?? null;

        return $name && isset($row[$name]) && $row[$name] !== '' ? (string) $row[$name] : $spec['entity'];
    }

    /** @return array<string, mixed> */
    private static function tariffExtras(array $row): array
    {
        $slabs = DB::table('cirt_electricity_tariff_slabs')->where('tariff_id', $row['id'] ?? '')->orderBy('sort_order')->get();
        $text = $slabs->map(fn ($s) => sprintf('%s-%s units @ %s', $s->from_unit, $s->to_unit ?? 'above', rtrim(rtrim(number_format((float) $s->rate_per_unit, 3, '.', ''), '0'), '.')))->implode('; ');

        return ['slabs' => $text !== '' ? $text : null];
    }

    private static function tariffName(array $row): string
    {
        return 'Electricity tariff effective '.($row['effective_from'] ? date('d/m/Y', strtotime((string) $row['effective_from'])) : '—');
    }

    private static function nightName(array $row): string
    {
        return sprintf('Night allowance rate: slab %s, Pay Level %s', $row['slab_no'] ?? '—', $row['pay_level'] ?? '—');
    }

    /** Effective date a settings change takes from, when the request carries one. */
    public static function effectiveDate(Request $request, array $spec): ?string
    {
        foreach ((array) ($spec['effectiveInput'] ?? []) as $key) {
            $v = $request->input($key);
            if (is_string($v) && $v !== '') return $v;
        }

        return null;
    }
}
