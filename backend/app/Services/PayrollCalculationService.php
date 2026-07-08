<?php

namespace App\Services;

use App\Support\PayrollFieldRegistry;

/**
 * Government payroll master calculations (aligned with src/lib/governmentPayroll.ts).
 */
final class PayrollCalculationService
{
    public const DEFAULT_CPF_RATE_ON_TOTAL_EARNINGS = 0.12;

    public const DEFAULT_DA_PERCENT = 53.0;

    public const DEFAULT_HRA_PERCENT = 30.0;

    public const DEFAULT_MEDICAL = 3000.0;

    /**
     * @return array{
     *   pay_level: int,
     *   gross_basic_pay: float,
     *   da_percent: float,
     *   hra_percent: float,
     *   medical: float,
     *   transport_base: float,
     *   transport_da: float,
     *   transport_total: float,
     *   transport_slab_group: string,
     *   da_amount: float,
     *   hra_amount: float,
     *   total_earnings: float,
     *   cpf_default: float,
     *   cpf_effective: float,
     *   da_cpf: float,
     *   total_deductions: float,
     *   take_home: float,
     *   professional_tax: float,
     *   income_tax: float,
     *   lic: float,
     *   mess: float,
     *   welfare: float,
     *   vpf: float,
     *   pf_loan: float,
     *   post_office: float,
     *   credit_society: float,
     *   standard_licence_fee: float,
     *   electricity: float,
     *   water: float,
     *   loan_recovery: float,
     *   vehicle_charge: float,
     *   other_deduction: float,
     *   advance: float,
     * }
     */
    public function calculateMaster(
        array $input,
        ?float $defaultDaPercent = null,
        ?float $defaultHraPercent = null,
        ?array $cpfConfig = null,
        ?array $customEarnings = null,
        ?array $customDeductions = null,
    ): array
    {
        $payLevel = max(1, (int) ($input['pay_level'] ?? $input['payLevel'] ?? 1));
        $grossBasic = max(0, (float) ($input['gross_basic_pay'] ?? $input['gross_basic'] ?? $input['grossBasicPay'] ?? 0));
        $daPercent = (float) ($input['da_percent'] ?? $input['daPercent'] ?? $defaultDaPercent ?? self::DEFAULT_DA_PERCENT);
        $hraPercent = (float) ($input['hra_percent'] ?? $input['hraPercent'] ?? $defaultHraPercent ?? self::DEFAULT_HRA_PERCENT);
        $medical = (float) ($input['medical'] ?? $input['medical_fixed'] ?? $input['medicalFixed'] ?? self::DEFAULT_MEDICAL);
        $slab = $this->deriveTransportSlab($payLevel);
        $transportBase = $slab['base'];
        $transportDa = $this->roundRupees($transportBase * $daPercent / 100);
        $transportTotal = $this->roundRupees($transportBase + $transportDa);

        $daAmount = $this->roundRupees($grossBasic * $daPercent / 100);
        $hraAmount = $this->roundRupees($grossBasic * $hraPercent / 100);

        $daAmount = $this->optionalAmountOverride($input, ['da_amount', 'daAmount'], $daAmount);
        $hasQuarter = $this->employeeHasQuarter($input);
        if ($hasQuarter) {
            $hraAmount = 0.0;
        } else {
            $hraAmount = $this->optionalAmountOverride($input, ['hra_amount', 'hraAmount', 'hra'], $hraAmount);
        }
        $transportBase = $this->optionalPositiveAmountOverride($input, ['transport_base', 'transportBase'], $transportBase);
        $transportDa = $this->optionalPositiveAmountOverride($input, ['transport_da', 'transportDa'], $transportDa);
        $transportTotal = $this->optionalPositiveAmountOverride(
            $input,
            ['transport_total', 'transportTotal', 'trans'],
            $this->roundRupees($transportBase + $transportDa),
        );

        $customEarnings = $customEarnings ?? [];
        $customDeductions = $customDeductions ?? [];
        $customEarningsTotal = $this->roundRupees(array_sum(array_map('floatval', $customEarnings)));
        $totalEarnings = $this->optionalAmountOverride(
            $input,
            ['total_earnings', 'totalEarnings', 'ctc'],
            $this->roundRupees($grossBasic + $daAmount + $hraAmount + $medical + $transportTotal + $customEarningsTotal),
        );

        $deductions = $this->extractDeductions($input);
        $cpfDefault = (float) ($input['cpf_default'] ?? $input['cpfDefault'] ?? $deductions['cpf']);
        $cpfPercentage = (float) ($cpfConfig['cpf_percentage'] ?? $cpfConfig['cpfPercentage'] ?? PayrollFieldRegistry::DEFAULT_CPF_PERCENTAGE);
        $cpfBasisKeys = $cpfConfig['cpf_basis_field_keys'] ?? $cpfConfig['cpfBasisFieldKeys'] ?? PayrollFieldRegistry::DEFAULT_CPF_BASIS_KEYS;
        $cpfMode = (string) ($cpfConfig['cpf_calculation_mode'] ?? $cpfConfig['cpfCalculationMode'] ?? 'percentage');
        $cpfFixed = (float) ($cpfConfig['cpf_fixed_amount'] ?? $cpfConfig['cpfFixedAmount'] ?? 0);
        $partialCalc = [
            'gross_basic_pay' => $grossBasic,
            'da_amount' => $daAmount,
            'hra_amount' => $hraAmount,
            'medical' => $medical,
            'transport_total' => $transportTotal,
        ];
        $cpfBasisAmount = PayrollFieldRegistry::resolveMasterCpfBasisAmount($partialCalc, $cpfBasisKeys, $customEarnings);
        if ($cpfDefault > 0) {
            $cpfEffective = $this->roundRupees($cpfDefault);
        } elseif ($cpfMode === 'fixed_amount' && $cpfFixed > 0) {
            $cpfEffective = $this->roundRupees($cpfFixed);
        } else {
            $cpfEffective = $this->roundRupees($cpfBasisAmount * ($cpfPercentage / 100));
        }

        $daCpf = $this->roundRupees((float) ($input['da_cpf'] ?? $input['da_cpf_default'] ?? $input['daCpf'] ?? $deductions['da_cpf']));
        $professionalTax = $this->roundRupees($deductions['professional_tax']);
        $incomeTax = $this->roundRupees($deductions['income_tax']);
        $advance = $this->roundRupees($deductions['advance']);

        $customDeductionsTotal = $this->roundRupees(array_sum(array_map('floatval', $customDeductions)));
        $quarterRent = $hasQuarter
            ? $this->roundRupees((float) $this->pick($input, ['quarter_rent', 'quarterRent'], 0))
            : 0.0;

        $totalDeductions = $this->roundRupees(
            $incomeTax + $professionalTax + $deductions['lic'] + $cpfEffective + $daCpf
            + $deductions['vpf'] + $deductions['pf_loan'] + $deductions['post_office']
            + $deductions['credit_society'] + $deductions['standard_licence_fee']
            + $deductions['electricity'] + $deductions['water'] + $deductions['mess']
            + $deductions['loan_recovery'] + $deductions['welfare'] + $deductions['hpl'] + $deductions['eol']
            + $deductions['vehicle_charge']
            + $deductions['other_deduction'] + $advance + $quarterRent + $customDeductionsTotal
        );

        $takeHome = $this->roundRupees($totalEarnings - $totalDeductions);

        return [
            'pay_level' => $payLevel,
            'gross_basic_pay' => $grossBasic,
            'da_percent' => $daPercent,
            'hra_percent' => $hraPercent,
            'medical' => $medical,
            'transport_base' => $transportBase,
            'transport_da' => $transportDa,
            'transport_total' => $transportTotal,
            'transport_slab_group' => $slab['group'],
            'transport_da_percent' => $daPercent,
            'da_amount' => $daAmount,
            'hra_amount' => $hraAmount,
            'total_earnings' => $totalEarnings,
            'cpf_default' => $cpfDefault,
            'cpf_effective' => $cpfEffective,
            'da_cpf' => $daCpf,
            'total_deductions' => $totalDeductions,
            'take_home' => $takeHome,
            'professional_tax' => $professionalTax,
            'income_tax' => $incomeTax,
            'lic' => $deductions['lic'],
            'mess' => $deductions['mess'],
            'welfare' => $deductions['welfare'],
            'vpf' => $deductions['vpf'],
            'pf_loan' => $deductions['pf_loan'],
            'post_office' => $deductions['post_office'],
            'credit_society' => $deductions['credit_society'],
            'standard_licence_fee' => $deductions['standard_licence_fee'],
            'electricity' => $deductions['electricity'],
            'water' => $deductions['water'],
            'loan_recovery' => $deductions['loan_recovery'],
            'welfare' => $deductions['welfare'],
            'hpl' => $deductions['hpl'],
            'eol' => $deductions['eol'],
            'vehicle_charge' => $deductions['vehicle_charge'],
            'other_deduction' => $deductions['other_deduction'],
            'advance' => $advance,
            'quarter_rent' => $quarterRent,
            'has_quarter' => $hasQuarter,
            'custom_earnings' => $customEarnings,
            'custom_deductions' => $customDeductions,
            'custom_earnings_total' => $customEarningsTotal,
            'custom_deductions_total' => $customDeductionsTotal,
        ];
    }

    public function getTransportBaseByPayLevel(int $payLevel): float
    {
        if ($payLevel >= 9) {
            return 7200.0;
        }
        if ($payLevel >= 3) {
            return 3600.0;
        }
        if ($payLevel >= 1) {
            return 1350.0;
        }

        return 0.0;
    }

    /** @return array{group: string, base: float} */
    public function deriveTransportSlab(int $payLevel, float $grossBasic = 0): array
    {
        if ($payLevel >= 9) {
            return ['group' => 'LEVEL_9_ABOVE', 'base' => 7200.0];
        }
        if ($payLevel >= 3) {
            return ['group' => 'LEVEL_3_8', 'base' => 3600.0];
        }
        if ($payLevel >= 1) {
            return ['group' => 'LEVEL_1_2', 'base' => 1350.0];
        }

        return ['group' => 'UNKNOWN', 'base' => 0.0];
    }

    /** @return array<string, float> */
    private function extractDeductions(array $input): array
    {
        $g = fn (array $keys, float $default = 0.0) => $this->roundRupees((float) $this->pick($input, $keys, $default));

        return [
            'income_tax' => $g(['income_tax', 'incomeTax', 'income_tax_default', 'tds'], 0),
            'professional_tax' => $g(['professional_tax', 'professionalTax', 'pt', 'pt_default'], 200),
            'lic' => $g(['lic', 'lic_default'], 0),
            'cpf' => $g(['cpf_default', 'cpfDefault'], 0),
            'da_cpf' => $g(['da_cpf', 'da_cpf_default', 'daCpf'], 0),
            'vpf' => $g(['vpf', 'vpf_default'], 0),
            'pf_loan' => 0.0,
            'post_office' => $g(['post_office', 'post_office_default', 'postOffice'], 0),
            'credit_society' => $g(['credit_society', 'credit_society_default', 'creditSociety'], 0),
            'standard_licence_fee' => 0.0,
            'electricity' => $g(['electricity', 'electricity_default'], 0),
            'water' => $g(['water', 'water_default'], 0),
            'mess' => $g(['mess', 'mess_default'], 0),
            'loan_recovery' => $g(['loan_recovery', 'loan_recovery_default', 'loanRecovery', 'loanRecoveryDefault', 'horticulture', 'horticulture_default', 'horticultureDefault'], 0),
            'welfare' => $g(['welfare', 'welfare_default'], 0),
            'hpl' => $g(['hpl'], 0),
            'eol' => $g(['eol'], 0),
            'vehicle_charge' => 0.0,
            'other_deduction' => $g(['other_deduction', 'other_deduction_default', 'otherDeduction'], 0),
            'advance' => $g(['advance', 'advance_bonus', 'advanceBonus'], 0),
        ];
    }

  /**
   * @param  list<string>  $keys
   */
    private function pick(array $input, array $keys, mixed $default = null): mixed
    {
        foreach ($keys as $key) {
            if (array_key_exists($key, $input) && $input[$key] !== null && $input[$key] !== '') {
                return $input[$key];
            }
        }

        return $default;
    }

    /**
     * @param  list<string>  $keys
     */
    private function optionalAmountOverride(array $input, array $keys, float $computed): float
    {
        $value = $this->pick($input, $keys, null);

        return $value === null ? $computed : $this->roundRupees((float) $value);
    }

    /**
     * @param  list<string>  $keys
     */
    private function optionalPositiveAmountOverride(array $input, array $keys, float $computed): float
    {
        $value = $this->pick($input, $keys, null);
        if ($value === null) {
            return $computed;
        }
        $parsed = $this->roundRupees((float) $value);

        return $parsed > 0 ? $parsed : $computed;
    }

    /** @param array<string, mixed> $input */
    private function employeeHasQuarter(array $input): bool
    {
        if (! empty($input['quarter_id'] ?? $input['quarterId'] ?? null)) {
            return true;
        }

        $flag = $input['has_quarter'] ?? $input['hasQuarter'] ?? $input['quarter_assigned'] ?? $input['quarterAssigned'] ?? false;
        if (is_string($flag)) {
            $v = strtolower(trim($flag));

            return in_array($v, ['yes', 'y', 'true', '1'], true);
        }

        return (bool) $flag;
    }

    private function roundRupees(float $n): float
    {
        return round($n, 0);
    }
}
