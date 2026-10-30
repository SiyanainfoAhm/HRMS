<?php

namespace App\Services;

use App\Support\PayrollFieldRegistry;

/**
 * Pure validation of a pending payroll population.  This deliberately reports
 * policy/data exceptions; it never substitutes a rate or changes a component.
 */
class PayrollPreflightValidationService
{
    /** @param list<array<string,mixed>> $rows @param array<string,mixed> $payrollConfig @return array<string,mixed> */
    public function validate(array $rows, array $payrollConfig, ?array $tariff, string $periodEnd): array
    {
        $errors = [];
        $warnings = [];
        $employeeResults = [];
        $knownCpfKeys = array_merge(PayrollFieldRegistry::DEFAULT_CPF_BASIS_KEYS, [
            'sp_pay', 'telephone_allowance', 'education_allowance', 'encashment', 'gpf',
            'extra_work_allowance', 'night_allowance', 'uniform_allowance', 'da_arrears',
            'transport_arrears', 'gross_arrears', 'net_arrears',
        ]);

        foreach ($rows as $row) {
            $employeeErrors = [];
            $employeeWarnings = [];
            $gov = is_array($row['govRecalc'] ?? null) ? $row['govRecalc'] : [];
            $label = trim((string) ($row['employeeName'] ?? $row['name'] ?? $row['employeeCode'] ?? 'Unknown employee'));
            $id = (string) ($row['employeeUserId'] ?? $row['employeeId'] ?? $label);
            $add = function (string $level, string $code, string $message) use (&$employeeErrors, &$employeeWarnings, $id, $label, &$errors, &$warnings): void {
                $issue = ['employeeId' => $id, 'employee' => $label, 'code' => $code, 'message' => $message];
                if ($level === 'error') { $employeeErrors[] = $issue; $errors[] = $issue; } else { $employeeWarnings[] = $issue; $warnings[] = $issue; }
            };

            if ($gov !== []) {
                foreach (['grossBasic', 'daPercent', 'hraPercent', 'medicalFixed'] as $key) {
                    if (!isset($gov[$key]) || !is_numeric($gov[$key]) || (float) $gov[$key] < 0) {
                        $add('error', 'INVALID_MASTER_COMPONENT', "Missing or invalid {$key} in the active payroll master.");
                    }
                }
                // HRA percentage is the employee's entitlement in Payroll Master, not
                // necessarily the amount payable for this run.  Quarter occupancy
                // suppresses payable HRA, while retaining that master entitlement for
                // when the quarter is released.  Only reject a calculated payable HRA.
                if ((bool) ($gov['hasQuarter'] ?? false)) {
                    $payableHra = $gov['hraPaid']
                        ?? $gov['hra_paid']
                        ?? $gov['hraActual']
                        ?? $gov['hra_actual']
                        ?? 0;
                    if (is_numeric($payableHra) && (float) $payableHra > 0) {
                        $add('error', 'HRA_QUARTER_CONFLICT', 'Residential-quarter employee has payable HRA above zero.');
                    }
                }
                $electricityApplicable = (bool) ($gov['electricityApplicable'] ?? false);
                $mode = (string) ($gov['electricityMode'] ?? 'unit_based');
                if ($electricityApplicable && $mode === 'unit_based') {
                    if (!is_numeric($gov['electricityUnitsConsumed'] ?? null) || (float) $gov['electricityUnitsConsumed'] < 0) {
                        $add('error', 'ELECTRICITY_UNITS_INVALID', 'Electricity billing units must be a non-negative number.');
                    }
                    if (!$tariff || empty($tariff['effectiveFrom']) || (string) $tariff['effectiveFrom'] > $periodEnd || empty($tariff['slabs'])) {
                        $add('error', 'ELECTRICITY_TARIFF_REQUIRED', 'Electricity billing is unit-based but no active effective tariff is available.');
                    }
                }
                if ($electricityApplicable && !in_array($mode, ['unit_based', 'manual_fixed'], true)) {
                    $add('error', 'ELECTRICITY_MODE_INVALID', 'Electricity billing mode must be unit_based or manual_fixed.');
                }

                $cpf = is_array($gov['cpfConfig'] ?? null) ? $gov['cpfConfig'] : [];
                $rate = $cpf['cpfPercentage'] ?? null;
                if (!is_numeric($rate) || (float) $rate < 0 || (float) $rate > 100) {
                    $add('error', 'CPF_RATE_INVALID', 'CPF rate is missing or outside 0–100%.');
                }
                foreach ((array) ($cpf['cpfBasisFieldKeys'] ?? []) as $key) {
                    if (!in_array($key, $knownCpfKeys, true)) $add('error', 'CPF_BASIS_INVALID', "CPF basis key {$key} is not an approved payroll component.");
                }
                if (($cpf['cpfCalculationMode'] ?? 'percentage') === 'fixed_amount' && (!is_numeric($cpf['cpfFixedAmount'] ?? null) || (float) $cpf['cpfFixedAmount'] < 0)) {
                    $add('error', 'CPF_FIXED_AMOUNT_INVALID', 'CPF fixed contribution is invalid.');
                }
                foreach ((array) ($row['customFieldValues'] ?? []) as $key => $value) {
                    if ($value !== '' && $value !== null && !is_numeric($value)) $add('error', 'CUSTOM_COMPONENT_INVALID', "Custom component {$key} is not numeric.");
                }
                $canonical = ['sp_pay' => 'spPayPaid', 'education_allowance' => 'educationAllowancePaid', 'encashment' => 'encashmentPaid'];
                foreach ($canonical as $key => $override) {
                    if ((float) (($gov['customEarnings'][$key] ?? 0)) !== 0 && isset($gov['earningPaidOverrides'][$override]) && (float) $gov['earningPaidOverrides'][$override] !== 0) {
                        $add('error', 'COMPONENT_DUPLICATED', "{$key} appears both as a canonical and a custom earning.");
                    }
                }
                if (isset($gov['transportTotal']) && (!is_numeric($gov['transportTotal']) || (float) $gov['transportTotal'] < 0)) {
                    $add('error', 'TRANSPORT_INVALID', 'Transport eligibility/rate produced an invalid amount.');
                }
            }
            $employeeResults[] = ['employeeId' => $id, 'employee' => $label, 'errors' => $employeeErrors, 'warnings' => $employeeWarnings];
        }

        return [
            'canCalculate' => $errors === [],
            'blockingErrorCount' => count($errors), 'warningCount' => count($warnings),
            'blockingErrors' => $errors, 'warnings' => $warnings, 'employees' => $employeeResults,
            'policyStatus' => ['cpf' => 'uses_saved_configuration', 'transport' => 'uses_saved_master_or_slab_value', 'hra' => 'effective-payable-amount-checked'],
        ];
    }

    /** @param list<array<string,mixed>> $rows @return list<array<string,mixed>> */
    public function validateCalculatedRows(array $rows): array
    {
        $issues = [];
        foreach ($rows as $row) {
            $gross = $row['grossPay'] ?? $row['gross_pay'] ?? null;
            $deductions = $row['deductions'] ?? $row['totalDeductions'] ?? $row['total_deductions'] ?? null;
            $net = $row['netPay'] ?? $row['net_pay'] ?? $row['takeHome'] ?? null;
            if (is_numeric($gross) && is_numeric($deductions) && is_numeric($net) && abs(((float) $gross - (float) $deductions) - (float) $net) > 0.01) {
                $issues[] = ['employeeId' => $row['employeeUserId'] ?? null, 'code' => 'TOTALS_DO_NOT_RECONCILE', 'message' => 'Gross minus deductions does not equal net pay.'];
            }
        }
        return $issues;
    }
}
