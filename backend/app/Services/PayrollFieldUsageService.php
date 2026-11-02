<?php

namespace App\Services;

use Illuminate\Support\Facades\DB;

/**
 * Read-only usage report for Earnings and Deductions field definitions (CIRT-04):
 * how many generated payroll rows carry a non-zero value and the last month used.
 * Custom (dynamic) fields are read from the custom_earnings / custom_deductions bags.
 */
final class PayrollFieldUsageService
{
    /** field_key => cirt_monthly_payroll numeric column (system fields). */
    public const MONTHLY_COLUMNS = [
        'gross_basic' => 'basic_paid', 'sp_pay' => 'sp_pay_paid', 'da' => 'da_paid', 'transport' => 'transport_paid',
        'hra' => 'hra_paid', 'medical' => 'medical_paid', 'extra_work_allowance' => 'extra_work_allowance_paid',
        'night_allowance' => 'night_allowance_paid', 'uniform_allowance' => 'uniform_allowance_paid',
        'education_allowance' => 'education_allowance_paid', 'encashment' => 'encashment_paid',
        'da_arrears' => 'da_arrears_paid', 'transport_arrears' => 'transport_arrears_paid',
        'gross_arrears' => 'gross_arrear', 'net_arrears' => 'net_arrear',
        'income_tax' => 'income_tax_amount', 'professional_tax' => 'pt_amount', 'lic' => 'lic_amount',
        'cpf' => 'cpf_amount', 'da_cpf' => 'da_cpf_amount', 'vpf' => 'vpf_amount', 'pf_loan' => 'pf_loan_amount',
        'post_office' => 'post_office_amount', 'credit_society' => 'credit_society_amount',
        'cpf_arrears' => 'cpf_arrear', 'standard_licence_fee' => 'std_licence_fee_amount',
        'electricity' => 'electricity_amount', 'water' => 'water_amount', 'mess' => 'mess_amount',
        'loan_recovery' => 'loan_recovery_amount', 'welfare' => 'welfare_amount', 'vehicle_charge' => 'veh_charge_amount',
        'other_deduction' => 'other_deduction_amount', 'quarter_rent' => 'quarter_rent_amount',
        'hpl' => 'hpl_amount', 'eol' => 'eol_amount',
    ];

    /** @return list<array<string, mixed>> */
    public function report(?string $companyId = null): array
    {
        $defs = DB::table('cirt_payroll_field_definitions')
            ->whereIn('field_group', ['earnings', 'deductions'])
            ->when($companyId, fn ($q) => $q->where('company_id', $companyId))
            ->orderBy('field_group')->orderBy('display_order')->orderBy('field_label')
            ->get(['company_id', 'field_label', 'field_key', 'field_group', 'is_system', 'is_active']);

        $out = [];
        foreach ($defs as $d) {
            $col = self::MONTHLY_COLUMNS[$d->field_key] ?? null;
            if ($col !== null) {
                $row = DB::selectOne("select count(*) filter (where {$col} <> 0) as n, to_char(max(month_year) filter (where {$col} <> 0), 'YYYY-MM') as last_used from cirt_monthly_payroll"
                    .($companyId ? ' where company_id = ?' : ''), $companyId ? [$companyId] : []);
                $source = "cirt_monthly_payroll.{$col}";
            } else {
                $bag = $d->field_group === 'earnings' ? 'custom_earnings' : 'custom_deductions';
                $row = DB::selectOne(
                    "select count(*) filter (where coalesce((t.{$bag}->>?)::numeric, 0) <> 0) as n, to_char(max(t.month_year) filter (where coalesce((t.{$bag}->>?)::numeric, 0) <> 0), 'YYYY-MM') as last_used from cirt_monthly_payroll t",
                    [$d->field_key, $d->field_key],
                );
                $source = "cirt_monthly_payroll.{$bag}['{$d->field_key}']";
            }
            $masterRow = DB::selectOne(
                "select count(*) as n from cirt_payroll_field_values where field_key = ? and field_value ~ '^-?[0-9]+(\\.[0-9]+)?$' and field_value::numeric <> 0",
                [$d->field_key],
            );
            $masterRows = isset($masterRow->n) ? $masterRow->n : 0;
            $out[] = [
                'field' => $d->field_label, 'key' => $d->field_key, 'group' => $d->field_group,
                'system' => (bool) $d->is_system, 'active' => (bool) $d->is_active,
                'rows_with_data' => (int) ($row->n ?? 0), 'last_used' => $row->last_used ?? null,
                'master_value_rows' => (int) $masterRows, 'source' => $source,
            ];
        }

        return $out;
    }
}
