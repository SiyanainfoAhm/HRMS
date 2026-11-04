<?php

namespace App\Support;

/**
 * Single PHP definition of which monthly lines make up gross, deductions and
 * net, mirroring SHEET_EARNING_KEYS / SHEET_DEDUCTION_KEYS in
 * src/lib/runPayrollSheetEdit.ts. Every line is a whole rupee (App\Support\Money), so the totals are exact sums.
 */
final class PayrollTotals
{
    public const EARNING_KEYS = [
        'basicPaid', 'spPayPaid', 'daPaid', 'transportPaid', 'hraPaid', 'medicalPaid',
        'extraWorkAllowancePaid', 'nightAllowancePaid', 'uniformAllowancePaid', 'educationAllowancePaid',
        'daArrearsPaid', 'transportArrearsPaid', 'encashmentPaid', 'encashmentDaPaid',
        'incentive', 'prBonus', 'reimbursement',
    ];

    public const DEDUCTION_KEYS = [
        'incomeTax', 'pt', 'lic', 'cpf', 'daCpf', 'vpf', 'pfLoan', 'postOffice', 'creditSociety',
        'stdLicenceFee', 'electricity', 'water', 'mess', 'loanRecovery', 'welfare', 'hpl', 'eol',
        'vehCharge', 'other', 'quarterRent',
    ];

    private const TOLERANCE = 0.01;

    public static function amount(mixed $value): float
    {
        return is_numeric($value) ? max(0.0, Money::roundMoney((float) $value)) : 0.0;
    }

    /**
     * THE arrears chain (mirror: arrearChain in src/lib/payrollArrearCalc.ts, shared fixture
     * tests/fixtures/arrear_chain_cases.json). DA, TR and CPF Arrears are the inputs; Gross Arrears = DA + TR
     * and Net Arrears = Gross - CPF Arrears are always derived, never typed. Gross Arrears is already inside the
     * DA and TR earning lines, so it is a memo (never added again); Net Arrears is a memo too.
     *
     * @return array{grossArrear: float, netArrear: float}
     */
    public static function arrearChain(mixed $da, mixed $tr, mixed $cpf): array
    {
        $n = static fn (mixed $v): float => Money::roundMoney(is_numeric($v) ? (float) $v : 0.0);
        $gross = Money::roundMoney($n($da) + $n($tr));

        return ['grossArrear' => $gross, 'netArrear' => Money::roundMoney($gross - $n($cpf))];
    }

    /** DA, TR and CPF Arrears of a monthly snapshot (camel or snake keys). */
    private static function arrearInputs(array $gm): array
    {
        return [
            self::amount($gm['daArrearsPaid'] ?? $gm['da_arrears_paid'] ?? 0),
            self::amount($gm['transportArrearsPaid'] ?? $gm['transport_arrears_paid'] ?? 0),
            self::amount($gm['cpfArrear'] ?? $gm['cpf_arrear'] ?? ($gm['arrearDeductions']['cpfArrear'] ?? 0)),
        ];
    }

    /** Total arrears in a month = Gross Arrears = DA + TR, counted once. */
    public static function arrearsTotal(array $gm): float
    {
        [$da, $tr] = self::arrearInputs($gm);

        return self::arrearChain($da, $tr, 0)['grossArrear'];
    }

    /** Net Arrears memo = Gross Arrears - CPF Arr (Gross = DA + TR). Not part of any total. */
    public static function netArrear(array $gm): float
    {
        return self::arrearChain(...self::arrearInputs($gm))['netArrear'];
    }

    /** Sum of the fixed (non-custom) earning lines. */
    public static function fixedEarnings(array $gm): float
    {
        $sum = 0.0;
        foreach (self::EARNING_KEYS as $key) $sum += self::amount($gm[$key] ?? 0);

        return Money::roundMoney($sum);
    }

    /** Sum of the fixed (non-custom) deduction lines incl. CPF arrear. */
    public static function fixedDeductions(array $gm): float
    {
        $ded = is_array($gm['deductions'] ?? null) ? $gm['deductions'] : [];
        $sum = 0.0;
        foreach (self::DEDUCTION_KEYS as $key) $sum += self::amount($ded[$key] ?? 0);
        $sum += self::amount($gm['cpfArrear'] ?? $gm['cpf_arrear'] ?? 0);

        return Money::roundMoney($sum);
    }

    private static function bagSum(mixed $bag): float
    {
        if (! is_array($bag)) return 0.0;
        $sum = 0.0;
        foreach ($bag as $value) $sum += self::amount($value);

        return Money::roundMoney($sum);
    }

    /**
     * Check that the stored aggregates equal their displayed components and that
     * gross - deductions = net. Returns field => message, empty when consistent.
     * Custom fields only count when their definition says so, so the check bounds
     * the custom contribution between 0 and the sum of all custom values.
     *
     * @return array<string, string>
     */
    public static function reconcile(array $gm): array
    {
        $issues = [];
        $totalEarnings = $gm['totalEarnings'] ?? $gm['total_earnings'] ?? null;
        $totalDeductions = $gm['totalDeductions'] ?? $gm['total_deductions'] ?? null;
        $net = $gm['netSalary'] ?? $gm['net_salary'] ?? null;
        if (! is_numeric($totalEarnings) || ! is_numeric($totalDeductions) || ! is_numeric($net)) {
            return ['totals' => 'Gross, total deductions and net pay must all be present and numeric.'];
        }
        $te = (float) $totalEarnings;
        $td = (float) $totalDeductions;
        if (abs(($te - $td) - (float) $net) > self::TOLERANCE) {
            $issues['netSalary'] = sprintf('Net pay %.2f does not equal gross %.2f minus deductions %.2f.', (float) $net, $te, $td);
        }
        $fixedE = self::fixedEarnings($gm);
        $customE = self::bagSum($gm['customEarnings'] ?? $gm['custom_earnings'] ?? null);
        if ($te + self::TOLERANCE < $fixedE || $te - self::TOLERANCE > $fixedE + $customE) {
            $issues['totalEarnings'] = sprintf('Gross %.2f does not match the sum of its earning lines (%.2f).', $te, $fixedE);
        }
        $fixedD = self::fixedDeductions($gm);
        $customD = self::bagSum($gm['customDeductions'] ?? $gm['custom_deductions'] ?? null);
        if ($td + self::TOLERANCE < $fixedD || $td - self::TOLERANCE > $fixedD + $customD) {
            $issues['totalDeductions'] = sprintf('Total deductions %.2f do not match the sum of the deduction lines (%.2f).', $td, $fixedD);
        }

        return $issues;
    }
}
