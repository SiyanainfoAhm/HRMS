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

    public const DEFAULT_TRANSPORT_LEVEL_9_PLUS = 7200.0;

    public const DEFAULT_TRANSPORT_LEVEL_3_8 = 3600.0;

    public const DEFAULT_TRANSPORT_LEVEL_1_2 = 1350.0;

    public const DEFAULT_TRANSPORT_LEVEL_1_2_ENHANCED = 3600.0;

    public const DEFAULT_TRANSPORT_BASIC_THRESHOLD = 24200.0;

    public const DEFAULT_TRANSPORT_HIGH_MIN_LEVEL = 9;

    public const DEFAULT_TRANSPORT_MID_MIN_LEVEL = 3;

    /**
     * @return array{
     *   level_9_plus: float,
     *   level_3_8: float,
     *   level_1_2: float,
     *   level_1_2_enhanced: float,
     *   basic_threshold: float,
     *   high_min_level: int,
     *   mid_min_level: int,
     * }
     */
    public static function defaultTransportConfig(): array
    {
        return [
            'level_9_plus' => self::DEFAULT_TRANSPORT_LEVEL_9_PLUS,
            'level_3_8' => self::DEFAULT_TRANSPORT_LEVEL_3_8,
            'level_1_2' => self::DEFAULT_TRANSPORT_LEVEL_1_2,
            'level_1_2_enhanced' => self::DEFAULT_TRANSPORT_LEVEL_1_2_ENHANCED,
            'basic_threshold' => self::DEFAULT_TRANSPORT_BASIC_THRESHOLD,
            'high_min_level' => self::DEFAULT_TRANSPORT_HIGH_MIN_LEVEL,
            'mid_min_level' => self::DEFAULT_TRANSPORT_MID_MIN_LEVEL,
        ];
    }

    /**
     * Normalize institute / request transport settings into calculation config keys.
     *
     * @param  array<string, mixed>|null  $config
     * @return array{
     *   level_9_plus: float,
     *   level_3_8: float,
     *   level_1_2: float,
     *   level_1_2_enhanced: float,
     *   basic_threshold: float,
     *   high_min_level: int,
     *   mid_min_level: int,
     * }
     */
    public static function normalizeTransportConfig(?array $config): array
    {
        $defaults = self::defaultTransportConfig();
        if ($config === null || $config === []) {
            return $defaults;
        }

        $pickFloat = static function (array $keys, float $fallback) use ($config): float {
            foreach ($keys as $key) {
                if (array_key_exists($key, $config) && $config[$key] !== null && $config[$key] !== '') {
                    return max(0, (float) $config[$key]);
                }
            }

            return $fallback;
        };

        $pickInt = static function (array $keys, int $fallback) use ($config): int {
            foreach ($keys as $key) {
                if (array_key_exists($key, $config) && $config[$key] !== null && $config[$key] !== '') {
                    return max(1, (int) $config[$key]);
                }
            }

            return $fallback;
        };

        $highMin = $pickInt([
            'high_min_level', 'highMinLevel',
            'transport_allowance_high_min_level', 'transportAllowanceHighMinLevel',
        ], $defaults['high_min_level']);
        $midMin = $pickInt([
            'mid_min_level', 'midMinLevel',
            'transport_allowance_mid_min_level', 'transportAllowanceMidMinLevel',
        ], $defaults['mid_min_level']);

        // Keep contiguous bands: mid < high.
        if ($midMin >= $highMin) {
            $midMin = max(1, $highMin - 1);
        }

        return [
            'level_9_plus' => $pickFloat([
                'level_9_plus', 'level9Plus',
                'transport_allowance_level_9_plus', 'transportAllowanceLevel9Plus',
            ], $defaults['level_9_plus']),
            'level_3_8' => $pickFloat([
                'level_3_8', 'level38',
                'transport_allowance_level_3_8', 'transportAllowanceLevel38',
            ], $defaults['level_3_8']),
            'level_1_2' => $pickFloat([
                'level_1_2', 'level12',
                'transport_allowance_level_1_2', 'transportAllowanceLevel12',
            ], $defaults['level_1_2']),
            'level_1_2_enhanced' => $pickFloat([
                'level_1_2_enhanced', 'level12Enhanced',
                'transport_allowance_level_1_2_enhanced', 'transportAllowanceLevel12Enhanced',
            ], $defaults['level_1_2_enhanced']),
            'basic_threshold' => $pickFloat([
                'basic_threshold', 'basicThreshold',
                'transport_allowance_basic_threshold', 'transportAllowanceBasicThreshold',
            ], $defaults['basic_threshold']),
            'high_min_level' => $highMin,
            'mid_min_level' => $midMin,
        ];
    }

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
        ?array $transportConfig = null,
    ): array
    {
        $payLevel = max(1, (int) ($input['pay_level'] ?? $input['payLevel'] ?? 1));
        $grossBasic = max(0, (float) ($input['gross_basic_pay'] ?? $input['gross_basic'] ?? $input['grossBasicPay'] ?? 0));
        $daPercent = (float) ($input['da_percent'] ?? $input['daPercent'] ?? $defaultDaPercent ?? self::DEFAULT_DA_PERCENT);
        $hraPercent = (float) ($input['hra_percent'] ?? $input['hraPercent'] ?? $defaultHraPercent ?? self::DEFAULT_HRA_PERCENT);
        $medical = (float) ($input['medical'] ?? $input['medical_fixed'] ?? $input['medicalFixed'] ?? self::DEFAULT_MEDICAL);
        $resolvedTransport = self::normalizeTransportConfig($transportConfig);
        $slab = $this->deriveTransportSlab($payLevel, $grossBasic, $resolvedTransport);
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
        $transportBase = $this->optionalAmountOverride($input, ['transport_base', 'transportBase'], $transportBase);
        $transportDa = $this->optionalAmountOverride($input, ['transport_da', 'transportDa'], $this->roundRupees($transportBase * $daPercent / 100));
        $transportTotal = $this->optionalAmountOverride(
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
        // Fixed-amount mode must honour explicit 0 (do not fall through to %).
        if ($cpfMode === 'fixed_amount') {
            $cpfEffective = $this->roundRupees($cpfFixed);
        } elseif ($cpfDefault > 0) {
            $cpfEffective = $this->roundRupees($cpfDefault);
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

    public function getTransportBaseByPayLevel(int $payLevel, float $grossBasic = 0, ?array $transportConfig = null): float
    {
        return $this->deriveTransportSlab($payLevel, $grossBasic, $transportConfig)['base'];
    }

    /**
     * @param  array<string, mixed>|null  $transportConfig
     * @return array{group: string, base: float}
     */
    public function deriveTransportSlab(int $payLevel, float $grossBasic = 0, ?array $transportConfig = null): array
    {
        $config = self::normalizeTransportConfig($transportConfig);
        $highMin = (int) $config['high_min_level'];
        $midMin = (int) $config['mid_min_level'];

        if ($payLevel >= $highMin) {
            return ['group' => 'LEVEL_9_ABOVE', 'base' => $config['level_9_plus']];
        }
        if ($payLevel >= $midMin) {
            return ['group' => 'LEVEL_3_8', 'base' => $config['level_3_8']];
        }
        if ($payLevel >= 1) {
            if ($grossBasic >= $config['basic_threshold']) {
                return ['group' => 'LEVEL_1_2_ENHANCED', 'base' => $config['level_1_2_enhanced']];
            }

            return ['group' => 'LEVEL_1_2', 'base' => $config['level_1_2']];
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
            'pf_loan' => $g(['pf_loan', 'pfLoan', 'pf_loan_default', 'pfLoanDefault'], 0),
            'post_office' => $g(['post_office', 'post_office_default', 'postOffice'], 0),
            'credit_society' => $g(['credit_society', 'credit_society_default', 'creditSociety'], 0),
            'standard_licence_fee' => $g(['standard_licence_fee', 'standardLicenceFee', 'std_licence_fee_default', 'stdLicenceFeeDefault'], 0),
            'electricity' => $g(['electricity', 'electricity_default'], 0),
            'water' => $g(['water', 'water_default'], 0),
            'mess' => $g(['mess', 'mess_default'], 0),
            'loan_recovery' => $g(['loan_recovery', 'loan_recovery_default', 'loanRecovery', 'loanRecoveryDefault', 'horticulture', 'horticulture_default', 'horticultureDefault'], 0),
            'welfare' => $g(['welfare', 'welfare_default'], 0),
            'hpl' => $g(['hpl'], 0),
            'eol' => $g(['eol'], 0),
            'vehicle_charge' => $g(['vehicle_charge', 'vehicleCharge', 'veh_charge_default', 'vehChargeDefault'], 0),
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
