<?php

namespace App\Support;

/**
 * Cross-check of one SAVED monthly payroll row (cirt_monthly_payroll snake_case columns, plus the
 * payslip's incentive / pr_bonus / reimbursement) used by the multi-period exports. The earning lines
 * (fixed components, the part of Gross Arrears not already in DA/TR arrears, the custom earning bag and
 * the three payslip lines) must add up to Total Earnings, the deduction lines (fixed lines, CPF Arr and
 * the custom deduction bag) to Total Deductions, and earnings - deductions to Net Pay. Same lines as
 * PayrollTotals::EARNING_KEYS / DEDUCTION_KEYS (the single definition behind screen, payslip and run).
 */
final class PayrollExportTotals
{
    private const EARNING_COLUMNS = [
        'basic_paid', 'da_paid', 'transport_paid', 'hra_paid', 'medical_paid',
        'extra_work_allowance_paid', 'night_allowance_paid', 'uniform_allowance_paid', 'education_allowance_paid',
        'da_arrears_paid', 'transport_arrears_paid', 'encashment_paid', 'encashment_da_paid',
        'incentive', 'pr_bonus', 'reimbursement',
    ];

    private const DEDUCTION_COLUMNS = [
        'income_tax_amount', 'pt_amount', 'lic_amount', 'cpf_amount', 'da_cpf_amount', 'vpf_amount', 'pf_loan_amount',
        'post_office_amount', 'credit_society_amount', 'electricity_amount', 'water_amount',
        'mess_amount', 'loan_recovery_amount', 'welfare_amount', 'hpl_amount', 'eol_amount', 'veh_charge_amount',
        'other_deduction_amount', 'quarter_rent_amount', 'cpf_arrear',
    ];

    private const TOLERANCE = 0.011;

    private static function n(array $row, string $key): float
    {
        return is_numeric($row[$key] ?? null) ? (float) $row[$key] : 0.0;
    }

    /** @return array<string, float> */
    public static function bag(mixed $raw): array
    {
        if (is_string($raw)) $raw = json_decode($raw, true);
        $out = [];
        foreach (is_array($raw) ? $raw : [] as $key => $value) {
            if (is_string($key) && is_numeric($value)) $out[$key] = (float) $value;
        }

        return $out;
    }

    public static function earnings(array $row): float
    {
        $sum = 0.0;
        foreach (self::EARNING_COLUMNS as $column) $sum += self::n($row, $column);
        $sum += array_sum(self::bag($row['custom_earnings'] ?? null));

        return round($sum, 2);
    }

    public static function deductions(array $row): float
    {
        $sum = 0.0;
        foreach (self::DEDUCTION_COLUMNS as $column) $sum += self::n($row, $column);
        $sum += array_sum(self::bag($row['custom_deductions'] ?? null));

        return round($sum, 2);
    }

    /** @return list<string> problems, empty when the row is consistent */
    public static function problems(array $row): array
    {
        $te = self::n($row, 'total_earnings');
        $td = self::n($row, 'total_deductions');
        $net = self::n($row, 'net_salary');
        $out = [];
        if (abs(self::earnings($row) - $te) > self::TOLERANCE) {
            $out[] = sprintf('earning columns add up to %.2f but Total Earnings is %.2f', self::earnings($row), $te);
        }
        if (abs(self::deductions($row) - $td) > self::TOLERANCE) {
            $out[] = sprintf('deduction columns add up to %.2f but Total Deductions is %.2f', self::deductions($row), $td);
        }
        if (abs(($te - $td) - $net) > self::TOLERANCE) {
            $out[] = sprintf('Total Earnings %.2f - Total Deductions %.2f is not Net Pay %.2f', $te, $td, $net);
        }

        return $out;
    }

    /** Fails loudly (HTTP 422) instead of producing a file whose totals do not add up. */
    public static function assertConsistent(array $row, string $who): void
    {
        $problems = self::problems($row);
        if ($problems !== []) {
            abort(422, "Payroll totals do not reconcile for {$who}: ".implode('; ', $problems).'.');
        }
    }
}
