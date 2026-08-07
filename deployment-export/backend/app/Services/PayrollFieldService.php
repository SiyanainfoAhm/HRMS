<?php

namespace App\Services;

use App\Models\HrmsPayrollCalculationSetting;
use App\Models\HrmsPayrollFieldDefinition;
use App\Models\HrmsPayrollFieldValue;
use App\Support\PayrollFieldRegistry;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

class PayrollFieldService
{
    public function ensureCompanyDefaults(string $companyId, ?string $createdBy = null): void
    {
        if (! Schema::hasTable('cirt_payroll_field_definitions')) {
            return;
        }

        foreach (PayrollFieldRegistry::systemFieldDefinitions() as $def) {
            $exists = HrmsPayrollFieldDefinition::query()
                ->where('company_id', $companyId)
                ->where('field_key', $def['field_key'])
                ->exists();
            if ($exists) {
                continue;
            }
            HrmsPayrollFieldDefinition::create([
                'id' => (string) Str::uuid(),
                'company_id' => $companyId,
                'created_by' => $createdBy,
                ...$def,
            ]);
        }

        $this->ensureCalculationSettings($companyId);
    }

    public function ensureCalculationSettings(string $companyId): HrmsPayrollCalculationSetting
    {
        $existing = HrmsPayrollCalculationSetting::query()->where('company_id', $companyId)->first();
        if ($existing) {
            return $existing;
        }

        return HrmsPayrollCalculationSetting::create([
            'id' => (string) Str::uuid(),
            'company_id' => $companyId,
            'cpf_percentage' => PayrollFieldRegistry::DEFAULT_CPF_PERCENTAGE,
            'cpf_basis_field_keys' => PayrollFieldRegistry::DEFAULT_CPF_BASIS_KEYS,
            'cpf_calculation_mode' => 'percentage',
            'cpf_fixed_amount' => 0,
            'electricity_unit_rate' => 0,
            'night_allowance_basic_ceiling' => NightAllowanceRateService::DEFAULT_BASIC_CEILING,
        ]);
    }

    /** @return array{fields: list<array<string, mixed>>, calculationSettings: array<string, mixed>} */
    public function getPayrollConfig(string $companyId, ?string $group = null, bool $activeOnly = true): array
    {
        $this->ensureCompanyDefaults($companyId);

        $query = HrmsPayrollFieldDefinition::query()
            ->where('company_id', $companyId)
            ->orderBy('display_order')
            ->orderBy('field_label');

        if ($activeOnly) {
            $query->where('is_active', true);
        }
        if ($group) {
            $query->where('field_group', $group);
        }

        $settings = $this->ensureCalculationSettings($companyId);
        $fields = $query->get()->map(fn (HrmsPayrollFieldDefinition $f) => $this->formatField($f))->values()->all();

        return [
            'fields' => $fields,
            'calculationSettings' => $this->formatCalculationSettings($settings, $fields),
        ];
    }

    /** @return list<array<string, mixed>> */
    public function listFields(string $companyId, ?string $group = null, ?bool $activeOnly = null): array
    {
        $this->ensureCompanyDefaults($companyId);

        $query = HrmsPayrollFieldDefinition::query()
            ->where('company_id', $companyId)
            ->orderBy('display_order')
            ->orderBy('field_label');

        if ($group) {
            $query->where('field_group', $group);
        }
        if ($activeOnly === true) {
            $query->where('is_active', true);
        } elseif ($activeOnly === false) {
            $query->where('is_active', false);
        }

        return $query->get()->map(fn (HrmsPayrollFieldDefinition $f) => $this->formatField($f))->values()->all();
    }

    /** @param array<string, mixed> $data */
    public function createField(string $companyId, array $data, ?string $createdBy = null): array
    {
        $this->ensureCompanyDefaults($companyId);

        $fieldKey = trim((string) ($data['field_key'] ?? $data['fieldKey'] ?? ''));
        if ($fieldKey === '') {
            $fieldKey = PayrollFieldRegistry::fieldKeyFromLabel((string) ($data['field_label'] ?? $data['fieldLabel'] ?? ''));
        }

        if (HrmsPayrollFieldDefinition::query()->where('company_id', $companyId)->where('field_key', $fieldKey)->exists()) {
            $existing = HrmsPayrollFieldDefinition::query()
                ->where('company_id', $companyId)
                ->where('field_key', $fieldKey)
                ->first();
            if ($existing && ! $existing->is_active && ! $existing->is_system) {
                throw ValidationException::withMessages([
                    'field_key' => [
                        'A deactivated field with this key already exists. Open Payroll Fields, find it in the list, and delete or reactivate it.',
                    ],
                ]);
            }

            throw ValidationException::withMessages(['field_key' => ['Field key must be unique.']]);
        }

        $group = (string) ($data['field_group'] ?? $data['fieldGroup'] ?? 'earnings');
        $includeEarnings = (bool) ($data['include_in_total_earnings'] ?? $data['includeInTotalEarnings'] ?? false);
        $includeDeductions = (bool) ($data['include_in_total_deductions'] ?? $data['includeInTotalDeductions'] ?? false);

        if ($group === 'earnings' && ! array_key_exists('include_in_total_earnings', $data) && ! array_key_exists('includeInTotalEarnings', $data)) {
            $includeEarnings = true;
        }
        if ($group === 'deductions' && ! array_key_exists('include_in_total_deductions', $data) && ! array_key_exists('includeInTotalDeductions', $data)) {
            $includeDeductions = true;
        }

        $field = HrmsPayrollFieldDefinition::create([
            'id' => (string) Str::uuid(),
            'company_id' => $companyId,
            'field_label' => trim((string) ($data['field_label'] ?? $data['fieldLabel'] ?? '')),
            'field_key' => $fieldKey,
            'field_group' => $group,
            'field_type' => (string) ($data['field_type'] ?? $data['fieldType'] ?? 'number'),
            'calculation_type' => (string) ($data['calculation_type'] ?? $data['calculationType'] ?? 'manual_entry'),
            'default_value' => $data['default_value'] ?? $data['defaultValue'] ?? null,
            'dropdown_options' => $data['dropdown_options'] ?? $data['dropdownOptions'] ?? null,
            'is_required' => (bool) ($data['is_required'] ?? $data['isRequired'] ?? false),
            'show_in_payroll_master' => (bool) ($data['show_in_payroll_master'] ?? $data['showInPayrollMaster'] ?? true),
            'show_in_run_payroll' => (bool) ($data['show_in_run_payroll'] ?? $data['showInRunPayroll'] ?? true),
            'show_in_salary_slip' => (bool) ($data['show_in_salary_slip'] ?? $data['showInSalarySlip'] ?? true),
            'include_in_total_earnings' => $includeEarnings,
            'include_in_total_deductions' => $includeDeductions,
            'is_system' => false,
            'is_active' => true,
            'display_order' => (int) ($data['display_order'] ?? $data['displayOrder'] ?? 999),
            'created_by' => $createdBy,
        ]);

        return $this->formatField($field);
    }

    /** @param array<string, mixed> $data */
    public function updateField(string $companyId, string $id, array $data): array
    {
        $field = HrmsPayrollFieldDefinition::query()->where('company_id', $companyId)->findOrFail($id);

        if ($field->is_system) {
            $allowed = [
                'show_in_payroll_master', 'showInPayrollMaster',
                'show_in_run_payroll', 'showInRunPayroll',
                'show_in_salary_slip', 'showInSalarySlip',
                'is_active', 'display_order', 'displayOrder',
                'default_value', 'defaultValue',
            ];
            $data = array_intersect_key($data, array_flip($allowed));
        }

        $newKey = trim((string) ($data['field_key'] ?? $data['fieldKey'] ?? $field->field_key));
        if ($newKey !== $field->field_key) {
            if ($field->is_system) {
                throw ValidationException::withMessages(['field_key' => ['System field key cannot be changed.']]);
            }
            if ($this->fieldHasValues($field)) {
                throw ValidationException::withMessages(['field_key' => ['Cannot change field key after values exist.']]);
            }
            if (HrmsPayrollFieldDefinition::query()->where('company_id', $companyId)->where('field_key', $newKey)->where('id', '!=', $id)->exists()) {
                throw ValidationException::withMessages(['field_key' => ['Field key must be unique.']]);
            }
        }

        $newType = (string) ($data['field_type'] ?? $data['fieldType'] ?? $field->field_type);
        if ($newType !== $field->field_type && $this->fieldHasValues($field)) {
            throw ValidationException::withMessages(['field_type' => ['Cannot change field type after values exist.']]);
        }

        $field->update([
            'field_label' => $data['field_label'] ?? $data['fieldLabel'] ?? $field->field_label,
            'field_key' => $newKey,
            'field_group' => $data['field_group'] ?? $data['fieldGroup'] ?? $field->field_group,
            'field_type' => $newType,
            'calculation_type' => $data['calculation_type'] ?? $data['calculationType'] ?? $field->calculation_type,
            'default_value' => array_key_exists('default_value', $data) ? $data['default_value'] : (array_key_exists('defaultValue', $data) ? $data['defaultValue'] : $field->default_value),
            'dropdown_options' => $data['dropdown_options'] ?? $data['dropdownOptions'] ?? $field->dropdown_options,
            'is_required' => array_key_exists('is_required', $data) ? (bool) $data['is_required'] : (array_key_exists('isRequired', $data) ? (bool) $data['isRequired'] : $field->is_required),
            'show_in_payroll_master' => array_key_exists('show_in_payroll_master', $data) ? (bool) $data['show_in_payroll_master'] : (array_key_exists('showInPayrollMaster', $data) ? (bool) $data['showInPayrollMaster'] : $field->show_in_payroll_master),
            'show_in_run_payroll' => array_key_exists('show_in_run_payroll', $data) ? (bool) $data['show_in_run_payroll'] : (array_key_exists('showInRunPayroll', $data) ? (bool) $data['showInRunPayroll'] : $field->show_in_run_payroll),
            'show_in_salary_slip' => array_key_exists('show_in_salary_slip', $data) ? (bool) $data['show_in_salary_slip'] : (array_key_exists('showInSalarySlip', $data) ? (bool) $data['showInSalarySlip'] : $field->show_in_salary_slip),
            'include_in_total_earnings' => array_key_exists('include_in_total_earnings', $data) ? (bool) $data['include_in_total_earnings'] : (array_key_exists('includeInTotalEarnings', $data) ? (bool) $data['includeInTotalEarnings'] : $field->include_in_total_earnings),
            'include_in_total_deductions' => array_key_exists('include_in_total_deductions', $data) ? (bool) $data['include_in_total_deductions'] : (array_key_exists('includeInTotalDeductions', $data) ? (bool) $data['includeInTotalDeductions'] : $field->include_in_total_deductions),
            'is_active' => array_key_exists('is_active', $data) ? (bool) $data['is_active'] : (array_key_exists('isActive', $data) ? (bool) $data['isActive'] : $field->is_active),
            'display_order' => (int) ($data['display_order'] ?? $data['displayOrder'] ?? $field->display_order),
        ]);

        return $this->formatField($field->refresh());
    }

    public function deactivateField(string $companyId, string $id): array
    {
        $field = HrmsPayrollFieldDefinition::query()->where('company_id', $companyId)->findOrFail($id);
        $field->update(['is_active' => false]);

        return $this->formatField($field->refresh());
    }

    public function deleteField(string $companyId, string $id): void
    {
        $field = HrmsPayrollFieldDefinition::query()->where('company_id', $companyId)->findOrFail($id);

        if ($field->is_system) {
            throw ValidationException::withMessages([
                'field' => ['System payroll fields cannot be deleted. Deactivate instead if you want to hide them.'],
            ]);
        }

        $settings = $this->ensureCalculationSettings($companyId);
        $basisKeys = $settings->cpf_basis_field_keys ?? [];
        if (in_array($field->field_key, $basisKeys, true)) {
            $remaining = array_values(array_filter($basisKeys, fn ($k) => $k !== $field->field_key));
            if ($remaining === []) {
                throw ValidationException::withMessages([
                    'field' => [
                        'This field is the only CPF basis field. Update institute CPF defaults before deleting it.',
                    ],
                ]);
            }
            $settings->update(['cpf_basis_field_keys' => $remaining]);
        }

        if (Schema::hasTable('cirt_payroll_field_values')) {
            HrmsPayrollFieldValue::query()->where('field_definition_id', $field->id)->delete();
        }

        $field->delete();
    }

    /** @param array<string, mixed> $data */
    public function saveCalculationSettings(string $companyId, array $data): array
    {
        $settings = $this->ensureCalculationSettings($companyId);
        $pct = (float) ($data['cpf_percentage'] ?? $data['cpfPercentage'] ?? $settings->cpf_percentage);
        $basis = $data['cpf_basis_field_keys'] ?? $data['cpfBasisFieldKeys'] ?? $settings->cpf_basis_field_keys;
        $mode = (string) ($data['cpf_calculation_mode'] ?? $data['cpfCalculationMode'] ?? $settings->cpf_calculation_mode ?? 'percentage');
        $fixed = (float) ($data['cpf_fixed_amount'] ?? $data['cpfFixedAmount'] ?? $settings->cpf_fixed_amount ?? 0);
        $elecRate = (float) ($data['electricity_unit_rate'] ?? $data['electricityUnitRate'] ?? $settings->electricity_unit_rate ?? 0);
        $nightCeiling = (float) (
            $data['night_allowance_basic_ceiling']
            ?? $data['nightAllowanceBasicCeiling']
            ?? $settings->night_allowance_basic_ceiling
            ?? NightAllowanceRateService::DEFAULT_BASIC_CEILING
        );

        if ($pct < 0) {
            throw ValidationException::withMessages(['cpf_percentage' => ['CPF percentage must be ≥ 0.']]);
        }
        if ($mode !== 'fixed_amount' && (! is_array($basis) || $basis === [])) {
            throw ValidationException::withMessages([
                'cpf_basis_field_keys' => ['Select at least one earning field for PF/CPF calculation.'],
            ]);
        }
        if ($elecRate < 0) {
            throw ValidationException::withMessages(['electricity_unit_rate' => ['Electricity unit rate must be ≥ 0.']]);
        }
        if ($nightCeiling < 0) {
            throw ValidationException::withMessages(['night_allowance_basic_ceiling' => ['Night allowance basic pay ceiling must be ≥ 0.']]);
        }

        $update = [
            'cpf_percentage' => $pct,
            'cpf_basis_field_keys' => is_array($basis) ? array_values(array_unique(array_map('strval', $basis))) : ($settings->cpf_basis_field_keys ?? []),
        ];
        if (Schema::hasColumn('cirt_payroll_calculation_settings', 'cpf_calculation_mode')) {
            $update['cpf_calculation_mode'] = $mode === 'fixed_amount' ? 'fixed_amount' : 'percentage';
        }
        if (Schema::hasColumn('cirt_payroll_calculation_settings', 'cpf_fixed_amount')) {
            $update['cpf_fixed_amount'] = max(0, $fixed);
        }
        if (Schema::hasColumn('cirt_payroll_calculation_settings', 'electricity_unit_rate')) {
            $update['electricity_unit_rate'] = max(0, $elecRate);
        }
        if (Schema::hasColumn('cirt_payroll_calculation_settings', 'night_allowance_basic_ceiling')) {
            $update['night_allowance_basic_ceiling'] = max(0, $nightCeiling);
        }

        $settings->update($update);

        $fields = HrmsPayrollFieldDefinition::query()->where('company_id', $companyId)->get()
            ->map(fn ($f) => $this->formatField($f))->values()->all();

        return $this->formatCalculationSettings($settings->refresh(), $fields);
    }

    /**
     * Resolve effective CPF config for a payroll master row.
     *
     * @param  array<string, mixed>|null  $input
     * @return array{cpf_percentage: float, cpf_basis_field_keys: array<int, string>, cpf_calculation_mode: string, cpf_fixed_amount: float, source: string}
     */
    public function resolveCpfConfigForMaster(
        string $companyId,
        ?\App\Models\HrmsPayrollMaster $master = null,
        ?array $input = null,
    ): array {
        $company = $this->ensureCalculationSettings($companyId);
        $useCompany = true;
        $pctOverride = null;
        $basisOverride = null;
        $inputHasBasisOverride = false;

        if ($master) {
            $useCompany = PayrollFieldRegistry::isCpfCompanyDefaultMode($master->cpf_use_company_settings ?? true);
            $pctOverride = $master->cpf_percentage_override;
            $basisOverride = $master->cpf_basis_field_keys_override;
        }

        if (is_array($input)) {
            if (array_key_exists('cpf_use_company_settings', $input) || array_key_exists('cpfUseCompanySettings', $input)) {
                $raw = $input['cpf_use_company_settings'] ?? $input['cpfUseCompanySettings'] ?? true;
                $useCompany = PayrollFieldRegistry::isCpfCompanyDefaultMode($raw);
            }
            if (array_key_exists('cpf_percentage_override', $input) || array_key_exists('cpfPercentageOverride', $input)) {
                $raw = $input['cpf_percentage_override'] ?? ($input['cpfPercentageOverride'] ?? null);
                $pctOverride = $raw === '' || $raw === null ? null : (float) $raw;
            }
            if (array_key_exists('cpf_basis_field_keys_override', $input) || array_key_exists('cpfBasisFieldKeysOverride', $input)) {
                $inputHasBasisOverride = true;
                $raw = $input['cpf_basis_field_keys_override'] ?? ($input['cpfBasisFieldKeysOverride'] ?? null);
                $basisOverride = is_array($raw) ? $raw : null;
            }
        }

        if ($useCompany) {
            return [
                'cpf_percentage' => (float) $company->cpf_percentage,
                'cpf_basis_field_keys' => $company->cpf_basis_field_keys ?? PayrollFieldRegistry::DEFAULT_CPF_BASIS_KEYS,
                'cpf_calculation_mode' => (string) ($company->cpf_calculation_mode ?? 'percentage'),
                'cpf_fixed_amount' => (float) ($company->cpf_fixed_amount ?? 0),
                'source' => 'company',
            ];
        }

        $pct = $pctOverride !== null ? (float) $pctOverride : (float) $company->cpf_percentage;
        if ($inputHasBasisOverride) {
            $basis = is_array($basisOverride)
                ? array_values(array_unique(array_map('strval', $basisOverride)))
                : [];
        } elseif (is_array($basisOverride) && $basisOverride !== []) {
            $basis = array_values(array_unique(array_map('strval', $basisOverride)));
        } else {
            $basis = $company->cpf_basis_field_keys ?? PayrollFieldRegistry::DEFAULT_CPF_BASIS_KEYS;
        }

        $mode = $master && $master->cpf_calculation_mode
            ? (string) $master->cpf_calculation_mode
            : (string) ($company->cpf_calculation_mode ?? 'percentage');
        $fixed = $master && $master->cpf_fixed_amount !== null
            ? (float) $master->cpf_fixed_amount
            : (float) ($company->cpf_fixed_amount ?? 0);

        if (is_array($input)) {
            if (array_key_exists('cpf_calculation_mode', $input) || array_key_exists('cpfCalculationMode', $input)) {
                $raw = $input['cpf_calculation_mode'] ?? $input['cpfCalculationMode'] ?? null;
                if ($raw !== null && $raw !== '') {
                    $mode = (string) $raw;
                }
            }
            if (array_key_exists('cpf_fixed_amount', $input) || array_key_exists('cpfFixedAmount', $input)) {
                $raw = $input['cpf_fixed_amount'] ?? $input['cpfFixedAmount'] ?? null;
                if ($raw !== null && $raw !== '') {
                    $fixed = (float) $raw;
                }
            }
        }

        return [
            'cpf_percentage' => $pct,
            'cpf_basis_field_keys' => $basis,
            'cpf_calculation_mode' => $mode === 'fixed_amount' ? 'fixed_amount' : 'percentage',
            'cpf_fixed_amount' => max(0, $fixed),
            'source' => 'employee',
        ];
    }

    /** @return array<string, mixed> */
    public function formatMasterCpfSettings(string $companyId, ?\App\Models\HrmsPayrollMaster $master): array
    {
        $companySettings = $this->ensureCalculationSettings($companyId);
        $fields = HrmsPayrollFieldDefinition::query()
            ->where('company_id', $companyId)
            ->where('is_active', true)
            ->get()
            ->map(fn ($f) => $this->formatField($f))
            ->values()
            ->all();
        $companyFormatted = $this->formatCalculationSettings($companySettings, $fields);
        $effective = $this->resolveCpfConfigForMaster($companyId, $master);

        $labelByKey = [];
        foreach ($fields as $f) {
            if (($f['fieldGroup'] ?? '') === 'earnings') {
                $labelByKey[$f['fieldKey']] = $f['fieldLabel'];
            }
        }
        $basisLabels = array_map(fn ($k) => $labelByKey[$k] ?? $k, $effective['cpf_basis_field_keys']);

        return [
            'cpfUseCompanySettings' => $master ? PayrollFieldRegistry::isCpfCompanyDefaultMode($master->cpf_use_company_settings ?? true) : true,
            'cpfPercentageOverride' => $master?->cpf_percentage_override !== null
                ? (float) $master->cpf_percentage_override
                : null,
            'cpfBasisFieldKeysOverride' => $master?->cpf_basis_field_keys_override ?? [],
            'companySettings' => $companyFormatted,
            'effectiveSettings' => [
                'cpfPercentage' => $effective['cpf_percentage'],
                'cpfBasisFieldKeys' => $effective['cpf_basis_field_keys'],
                'cpfFormulaPreview' => PayrollFieldRegistry::cpfFormulaPreview(
                    $basisLabels,
                    $effective['cpf_percentage'],
                ),
                'source' => $effective['source'],
            ],
        ];
    }

    /** @return array<string, string> */
    public function getCustomFieldValuesForMaster(string $companyId, string $masterId): array
    {
        if (! Schema::hasTable('cirt_payroll_field_values')) {
            return [];
        }

        return HrmsPayrollFieldValue::query()
            ->where('company_id', $companyId)
            ->where('payroll_master_id', $masterId)
            ->pluck('field_value', 'field_key')
            ->all();
    }

    /**
     * Batch-load custom field values for many payroll master rows (avoids N+1).
     *
     * @param  list<string>  $masterIds
     * @return array<string, array<string, string>>
     */
    public function getCustomFieldValuesForMasters(string $companyId, array $masterIds): array
    {
        if (! Schema::hasTable('cirt_payroll_field_values') || $masterIds === []) {
            return [];
        }

        $out = [];
        foreach (HrmsPayrollFieldValue::query()
            ->where('company_id', $companyId)
            ->whereIn('payroll_master_id', $masterIds)
            ->get(['payroll_master_id', 'field_key', 'field_value']) as $row) {
            $mid = (string) $row->payroll_master_id;
            $out[$mid] ??= [];
            $out[$mid][(string) $row->field_key] = (string) ($row->field_value ?? '');
        }

        return $out;
    }

    /** @param array<string, mixed> $values */
    public function saveCustomFieldValuesForMaster(
        string $companyId,
        string $masterId,
        ?string $employeeId,
        array $values,
    ): void {
        if (! Schema::hasTable('cirt_payroll_field_values')) {
            return;
        }

        $customFields = HrmsPayrollFieldDefinition::query()
            ->where('company_id', $companyId)
            ->where('is_active', true)
            ->where('is_system', false)
            ->get()
            ->keyBy('field_key');

        foreach ($values as $key => $raw) {
            $fieldKey = (string) $key;
            $def = $customFields->get($fieldKey);
            if (! $def) {
                continue;
            }
            $val = is_scalar($raw) || $raw === null ? (string) ($raw ?? '') : json_encode($raw);

            HrmsPayrollFieldValue::updateOrCreate(
                [
                    'company_id' => $companyId,
                    'payroll_master_id' => $masterId,
                    'field_definition_id' => $def->id,
                ],
                [
                    'employee_id' => $employeeId,
                    'field_key' => $fieldKey,
                    'field_value' => $val,
                ],
            );
        }
    }

    /** @return list<array{field: string, message: string}> */
    public function validateCustomFieldValues(string $companyId, array $values, bool $isEdit = false): array
    {
        $errors = [];
        $fields = HrmsPayrollFieldDefinition::query()
            ->where('company_id', $companyId)
            ->where('is_active', true)
            ->where('is_system', false)
            ->where('show_in_payroll_master', true)
            ->get();

        foreach ($fields as $field) {
            $raw = $values[$field->field_key] ?? $values[Str::camel($field->field_key)] ?? null;
            $str = trim((string) ($raw ?? ''));

            if ($field->is_required && $str === '' && ! $isEdit) {
                $errors[] = ['field' => $field->field_key, 'message' => "{$field->field_label} is required."];

                continue;
            }
            if ($str === '') {
                continue;
            }

            if (in_array($field->field_type, ['number', 'percentage'], true) && ! is_numeric($str)) {
                $errors[] = ['field' => $field->field_key, 'message' => "{$field->field_label} must be numeric."];
            }
            if ($field->field_type === 'date' && strtotime($str) === false) {
                $errors[] = ['field' => $field->field_key, 'message' => "{$field->field_label} must be a valid date."];
            }
            if ($field->field_type === 'dropdown' && is_array($field->dropdown_options) && $field->dropdown_options !== []) {
                if (! in_array($str, $field->dropdown_options, true)) {
                    $errors[] = ['field' => $field->field_key, 'message' => "{$field->field_label} has an invalid option."];
                }
            }
        }

        return $errors;
    }

    /** @return list<array{0: string, 1: string, 2: string, 3: string, 4: string, 5: string, 6: string, 7: string}> */
    public function templateInstructionFieldRows(string $companyId): array
    {
        $this->ensureCompanyDefaults($companyId);

        return HrmsPayrollFieldDefinition::query()
            ->where('company_id', $companyId)
            ->where('is_active', true)
            ->where('is_system', false)
            ->where('show_in_payroll_master', true)
            ->orderBy('display_order')
            ->orderBy('field_label')
            ->get()
            ->map(function (HrmsPayrollFieldDefinition $f) {
                $allowed = '';
                if ($f->field_type === 'dropdown' && is_array($f->dropdown_options) && $f->dropdown_options !== []) {
                    $allowed = implode(', ', $f->dropdown_options);
                }

                return [
                    $f->field_label,
                    $f->field_key,
                    ucfirst((string) $f->field_group),
                    $f->field_type,
                    $f->is_required ? 'Yes' : 'No',
                    $f->include_in_total_earnings ? 'Yes' : 'No',
                    $f->include_in_total_deductions ? 'Yes' : 'No',
                    $allowed,
                ];
            })
            ->values()
            ->all();
    }

    /** @return list<array<string, mixed>> */
    public function masterDisplayFields(string $companyId): array
    {
        $this->ensureCompanyDefaults($companyId);

        return HrmsPayrollFieldDefinition::query()
            ->where('company_id', $companyId)
            ->where('is_active', true)
            ->where('is_system', false)
            ->where('show_in_payroll_master', true)
            ->orderBy('display_order')
            ->orderBy('field_label')
            ->get()
            ->map(fn (HrmsPayrollFieldDefinition $f) => $this->formatField($f))
            ->values()
            ->all();
    }

    /** @return array<string, float> */
    public function customEarningsForTotal(string $companyId, array $values): array
    {
        $out = [];
        $fields = HrmsPayrollFieldDefinition::query()
            ->where('company_id', $companyId)
            ->where('is_active', true)
            ->where('is_system', false)
            ->where('field_group', 'earnings')
            ->where('include_in_total_earnings', true)
            ->get();

        foreach ($fields as $field) {
            $raw = $values[$field->field_key] ?? null;
            if ($raw === null || $raw === '') {
                continue;
            }
            $out[$field->field_key] = (float) $raw;
        }

        return $out;
    }

    /** @return array<string, float> */
    public function customDeductionsForTotal(string $companyId, array $values): array
    {
        $out = [];
        $fields = HrmsPayrollFieldDefinition::query()
            ->where('company_id', $companyId)
            ->where('is_active', true)
            ->where('is_system', false)
            ->whereIn('field_group', ['deductions', 'statutory'])
            ->where('include_in_total_deductions', true)
            ->get();

        foreach ($fields as $field) {
            $raw = $values[$field->field_key] ?? null;
            if ($raw === null || $raw === '') {
                continue;
            }
            $out[$field->field_key] = (float) $raw;
        }

        return $out;
    }

    /** @return array<string, float> */
    public function customEarningsFromValues(string $companyId, array $values): array
    {
        $out = [];
        $fields = HrmsPayrollFieldDefinition::query()
            ->where('company_id', $companyId)
            ->where('is_active', true)
            ->where('is_system', false)
            ->where('field_group', 'earnings')
            ->get();

        foreach ($fields as $field) {
            $raw = $values[$field->field_key] ?? null;
            if ($raw === null || $raw === '') {
                continue;
            }
            $out[$field->field_key] = (float) $raw;
        }

        return $out;
    }

    /** @return array<string, float> */
    public function customDeductionsFromValues(string $companyId, array $values): array
    {
        $out = [];
        $fields = HrmsPayrollFieldDefinition::query()
            ->where('company_id', $companyId)
            ->where('is_active', true)
            ->where('is_system', false)
            ->whereIn('field_group', ['deductions', 'statutory'])
            ->get();

        foreach ($fields as $field) {
            $raw = $values[$field->field_key] ?? null;
            if ($raw === null || $raw === '') {
                continue;
            }
            $out[$field->field_key] = (float) $raw;
        }

        return $out;
    }

    /** @return list<array{key: string, header: string, required_in_template: bool}> */
    public function customImportColumns(string $companyId): array
    {
        $this->ensureCompanyDefaults($companyId);

        return HrmsPayrollFieldDefinition::query()
            ->where('company_id', $companyId)
            ->where('is_active', true)
            ->where('is_system', false)
            ->where('show_in_payroll_master', true)
            ->orderBy('display_order')
            ->orderBy('field_label')
            ->get()
            ->map(fn (HrmsPayrollFieldDefinition $f) => [
                'key' => $f->field_key,
                'header' => $f->field_label.($f->is_required ? '*' : ''),
                'required_in_template' => $f->is_required,
            ])
            ->values()
            ->all();
    }

    public function getCpfSettingsForCompany(string $companyId): HrmsPayrollCalculationSetting
    {
        return $this->ensureCalculationSettings($companyId);
    }

    private function fieldHasValues(HrmsPayrollFieldDefinition $field): bool
    {
        if (! Schema::hasTable('cirt_payroll_field_values')) {
            return false;
        }

        return HrmsPayrollFieldValue::query()->where('field_definition_id', $field->id)->exists();
    }

  /** @return array<string, mixed> */
    private function formatField(HrmsPayrollFieldDefinition $field): array
    {
        return [
            'id' => $field->id,
            'fieldLabel' => $field->field_label,
            'fieldKey' => $field->field_key,
            'fieldGroup' => $field->field_group,
            'fieldType' => $field->field_type,
            'calculationType' => $field->calculation_type,
            'defaultValue' => $field->default_value,
            'dropdownOptions' => $field->dropdown_options ?? [],
            'isRequired' => $field->is_required,
            'showInPayrollMaster' => $field->show_in_payroll_master,
            'showInRunPayroll' => $field->show_in_run_payroll,
            'showInSalarySlip' => $field->show_in_salary_slip,
            'includeInTotalEarnings' => $field->include_in_total_earnings,
            'includeInTotalDeductions' => $field->include_in_total_deductions,
            'isSystem' => $field->is_system,
            'isActive' => $field->is_active,
            'displayOrder' => $field->display_order,
        ];
    }

    /** @param list<array<string, mixed>> $fields */
    private function formatCalculationSettings(HrmsPayrollCalculationSetting $settings, array $fields): array
    {
        $labelByKey = [];
        foreach ($fields as $f) {
            if (($f['fieldGroup'] ?? '') === 'earnings') {
                $labelByKey[$f['fieldKey']] = $f['fieldLabel'];
            }
        }
        $basisLabels = array_map(fn ($k) => $labelByKey[$k] ?? $k, $settings->cpf_basis_field_keys ?? []);

        return [
            'cpfPercentage' => (float) $settings->cpf_percentage,
            'cpfBasisFieldKeys' => $settings->cpf_basis_field_keys ?? [],
            'cpfCalculationMode' => Schema::hasColumn('cirt_payroll_calculation_settings', 'cpf_calculation_mode')
                ? (string) ($settings->cpf_calculation_mode ?? 'percentage')
                : 'percentage',
            'cpfFixedAmount' => Schema::hasColumn('cirt_payroll_calculation_settings', 'cpf_fixed_amount')
                ? (float) ($settings->cpf_fixed_amount ?? 0)
                : 0,
            'electricityUnitRate' => Schema::hasColumn('cirt_payroll_calculation_settings', 'electricity_unit_rate')
                ? (float) ($settings->electricity_unit_rate ?? 0)
                : 0,
            'nightAllowanceBasicCeiling' => Schema::hasColumn('cirt_payroll_calculation_settings', 'night_allowance_basic_ceiling')
                ? (float) ($settings->night_allowance_basic_ceiling ?? NightAllowanceRateService::DEFAULT_BASIC_CEILING)
                : NightAllowanceRateService::DEFAULT_BASIC_CEILING,
            'cpfFormulaPreview' => PayrollFieldRegistry::cpfFormulaPreview(
                $basisLabels,
                (float) $settings->cpf_percentage,
                Schema::hasColumn('cirt_payroll_calculation_settings', 'cpf_calculation_mode')
                    ? (string) ($settings->cpf_calculation_mode ?? 'percentage')
                    : 'percentage',
                Schema::hasColumn('cirt_payroll_calculation_settings', 'cpf_fixed_amount')
                    ? (float) ($settings->cpf_fixed_amount ?? 0)
                    : 0,
            ),
        ];
    }
}
