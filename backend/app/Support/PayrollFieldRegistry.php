<?php

namespace App\Support;

/**
 * Default payroll field definitions and CPF basis keys.
 * System fields map to existing cirt_payroll_master columns.
 */
final class PayrollFieldRegistry
{
    public const DEFAULT_CPF_PERCENTAGE = 12.0;

    /** Matches legacy total_earnings components at master level. */
    public const DEFAULT_CPF_BASIS_KEYS = [
        'gross_basic',
        'da',
        'hra',
        'medical',
        'transport',
    ];

    public const FIELD_GROUPS = [
        'basic',
        'earnings',
        'statutory',
        'deductions',
        'bank',
    ];

    public const FIELD_TYPES = [
        'text',
        'number',
        'percentage',
        'date',
        'dropdown',
    ];

    public const CALCULATION_TYPES = [
        'manual_entry',
        'fixed_amount',
        'percentage_based',
        'formula_based',
    ];

    /** @return list<array<string, mixed>> */
    public static function systemFieldDefinitions(): array
    {
        $order = 0;
        $row = fn (array $def) => array_merge([
            'is_system' => true,
            'is_active' => true,
            'is_required' => false,
            'calculation_type' => 'manual_entry',
            'show_in_payroll_master' => true,
            'show_in_run_payroll' => true,
            'show_in_salary_slip' => true,
        ], $def, ['display_order' => $def['display_order'] ?? (++$order)]);

        return [
            $row(['field_label' => 'Increment Month', 'field_key' => 'increment_month', 'field_group' => 'basic', 'field_type' => 'dropdown', 'dropdown_options' => ['January', 'July'], 'is_required' => true]),
            $row(['field_label' => 'Basic', 'field_key' => 'gross_basic', 'field_group' => 'earnings', 'field_type' => 'number', 'include_in_total_earnings' => true]),
            $row(['field_label' => 'SP Pay', 'field_key' => 'sp_pay', 'field_group' => 'earnings', 'field_type' => 'number', 'include_in_total_earnings' => true]),
            $row(['field_label' => 'DA', 'field_key' => 'da', 'field_group' => 'earnings', 'field_type' => 'percentage', 'include_in_total_earnings' => true]),
            $row(['field_label' => 'Transport', 'field_key' => 'transport', 'field_group' => 'earnings', 'field_type' => 'number', 'include_in_total_earnings' => true]),
            $row(['field_label' => 'HRA', 'field_key' => 'hra', 'field_group' => 'earnings', 'field_type' => 'percentage', 'include_in_total_earnings' => true]),
            $row(['field_label' => 'Medical', 'field_key' => 'medical', 'field_group' => 'earnings', 'field_type' => 'number', 'include_in_total_earnings' => true, 'default_value' => '3000']),
            $row(['field_label' => 'Extra Work Allowance', 'field_key' => 'extra_work_allowance', 'field_group' => 'earnings', 'field_type' => 'number', 'include_in_total_earnings' => true]),
            $row(['field_label' => 'N. All.', 'field_key' => 'night_allowance', 'field_group' => 'earnings', 'field_type' => 'number', 'include_in_total_earnings' => true]),
            $row(['field_label' => 'Uniform Allowance', 'field_key' => 'uniform_allowance', 'field_group' => 'earnings', 'field_type' => 'number', 'include_in_total_earnings' => true]),
            $row(['field_label' => 'Education Allowance', 'field_key' => 'education_allowance', 'field_group' => 'earnings', 'field_type' => 'number', 'include_in_total_earnings' => true]),
            $row(['field_label' => 'DA Arrears', 'field_key' => 'da_arrears', 'field_group' => 'earnings', 'field_type' => 'number', 'include_in_total_earnings' => true]),
            $row(['field_label' => 'Transport Arrears', 'field_key' => 'transport_arrears', 'field_group' => 'earnings', 'field_type' => 'number', 'include_in_total_earnings' => true]),
            $row(['field_label' => 'Gross Arrears', 'field_key' => 'gross_arrears', 'field_group' => 'earnings', 'field_type' => 'number', 'include_in_total_earnings' => true]),
            $row(['field_label' => 'Net Arrears', 'field_key' => 'net_arrears', 'field_group' => 'earnings', 'field_type' => 'number', 'include_in_total_earnings' => true]),
            $row(['field_label' => 'UAN', 'field_key' => 'uan', 'field_group' => 'statutory', 'field_type' => 'text']),
            $row(['field_label' => 'CPF No', 'field_key' => 'cpf_no', 'field_group' => 'statutory', 'field_type' => 'text']),
            $row(['field_label' => 'PAN', 'field_key' => 'pan', 'field_group' => 'statutory', 'field_type' => 'text', 'is_required' => true]),
            $row(['field_label' => 'Aadhaar', 'field_key' => 'aadhaar', 'field_group' => 'statutory', 'field_type' => 'text', 'is_required' => true]),
            $row(['field_label' => 'Income Tax', 'field_key' => 'income_tax', 'field_group' => 'deductions', 'field_type' => 'number', 'include_in_total_deductions' => true]),
            $row(['field_label' => 'Professional Tax', 'field_key' => 'professional_tax', 'field_group' => 'deductions', 'field_type' => 'number', 'include_in_total_deductions' => true, 'default_value' => '200']),
            $row(['field_label' => 'LIC', 'field_key' => 'lic', 'field_group' => 'deductions', 'field_type' => 'number', 'include_in_total_deductions' => true]),
            $row(['field_label' => 'CPF', 'field_key' => 'cpf', 'field_group' => 'deductions', 'field_type' => 'number', 'include_in_total_deductions' => true, 'calculation_type' => 'formula_based']),
            $row(['field_label' => 'DA CPF', 'field_key' => 'da_cpf', 'field_group' => 'deductions', 'field_type' => 'number', 'include_in_total_deductions' => true]),
            $row(['field_label' => 'VPF', 'field_key' => 'vpf', 'field_group' => 'deductions', 'field_type' => 'number', 'include_in_total_deductions' => true]),
            $row(['field_label' => 'Post Office', 'field_key' => 'post_office', 'field_group' => 'deductions', 'field_type' => 'number', 'include_in_total_deductions' => true]),
            $row(['field_label' => 'Credit Society', 'field_key' => 'credit_society', 'field_group' => 'deductions', 'field_type' => 'number', 'include_in_total_deductions' => true]),
            $row(['field_label' => 'CPF Arrears', 'field_key' => 'cpf_arrears', 'field_group' => 'deductions', 'field_type' => 'number', 'include_in_total_deductions' => true]),
            $row(['field_label' => 'Electricity', 'field_key' => 'electricity', 'field_group' => 'deductions', 'field_type' => 'number', 'include_in_total_deductions' => true]),
            $row(['field_label' => 'Water', 'field_key' => 'water', 'field_group' => 'deductions', 'field_type' => 'number', 'include_in_total_deductions' => true]),
            $row(['field_label' => 'Mess', 'field_key' => 'mess', 'field_group' => 'deductions', 'field_type' => 'number', 'include_in_total_deductions' => true]),
            $row(['field_label' => 'Bank Recovery', 'field_key' => 'loan_recovery', 'field_group' => 'deductions', 'field_type' => 'number', 'include_in_total_deductions' => true]),
            $row(['field_label' => 'Welfare', 'field_key' => 'welfare', 'field_group' => 'deductions', 'field_type' => 'number', 'include_in_total_deductions' => true]),
            $row(['field_label' => 'Other Deduction', 'field_key' => 'other_deduction', 'field_group' => 'deductions', 'field_type' => 'number', 'include_in_total_deductions' => true]),
            $row(['field_label' => 'Advance', 'field_key' => 'advance', 'field_group' => 'deductions', 'field_type' => 'number', 'include_in_total_deductions' => true]),
            $row(['field_label' => 'Bank Name', 'field_key' => 'bank_name', 'field_group' => 'bank', 'field_type' => 'text']),
            $row(['field_label' => 'Bank Account Number', 'field_key' => 'bank_account_number', 'field_group' => 'bank', 'field_type' => 'text', 'is_required' => true]),
            $row(['field_label' => 'IFSC Code', 'field_key' => 'bank_ifsc', 'field_group' => 'bank', 'field_type' => 'text']),
        ];
    }

    public static function fieldKeyFromLabel(string $label): string
    {
        $key = strtolower(trim($label));
        $key = preg_replace('/[^a-z0-9]+/', '_', $key) ?? '';
        $key = trim($key, '_');

        return $key !== '' ? $key : 'field';
    }

    /**
     * Resolve earning amounts for CPF basis from master calculation context.
     *
     * @param  array<string, float>  $customEarnings
     */
    public static function resolveMasterCpfBasisAmount(array $calc, array $basisKeys, array $customEarnings = []): float
    {
        $amounts = [
            'gross_basic' => (float) ($calc['gross_basic_pay'] ?? 0),
            'da' => (float) ($calc['da_amount'] ?? 0),
            'hra' => (float) ($calc['hra_amount'] ?? 0),
            'medical' => (float) ($calc['medical'] ?? 0),
            'transport' => (float) ($calc['transport_total'] ?? 0),
            'sp_pay' => 0.0,
            'extra_work_allowance' => 0.0,
            'night_allowance' => 0.0,
            'uniform_allowance' => 0.0,
            'education_allowance' => 0.0,
            'da_arrears' => 0.0,
            'transport_arrears' => 0.0,
            'gross_arrears' => 0.0,
            'net_arrears' => 0.0,
        ];

        $sum = 0.0;
        foreach ($basisKeys as $key) {
            if (array_key_exists($key, $customEarnings)) {
                $sum += (float) $customEarnings[$key];
            } elseif (array_key_exists($key, $amounts)) {
                $sum += (float) $amounts[$key];
            }
        }

        return round($sum);
    }

    public static function cpfFormulaPreview(array $basisLabels, float $percentage): string
    {
        $labels = $basisLabels !== [] ? implode(' + ', $basisLabels) : '—';
        $pct = rtrim(rtrim(number_format($percentage, 2, '.', ''), '0'), '.');

        return "CPF = ({$labels}) × {$pct}%";
    }
}
