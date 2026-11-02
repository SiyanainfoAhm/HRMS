<?php

namespace App\Support;

/**
 * Single backend source of display labels for the arrears family and the
 * CPF-arrear deduction (CIRT-05/06/07). Mirror of src/lib/payrollLabels.ts.
 */
final class PayrollLabels
{
    public const DA_ARREARS = 'DA Arrears';

    public const TRANSPORT_ARREARS = 'TR Arrears';

    /** First arrears field (aggregate; contains DA + TR arrears). */
    public const GROSS_ARREARS = 'Gross Arrears';

    /** Second arrears field: open free-entry earning, no formula. */
    public const PAST_ARREARS = 'Past Arrears';

    /** Derived memo: Gross Arrears - CPF Arr. Never added to totals. */
    public const NET_ARREARS = 'Net Arrears';

    /** Deduction: CPF recovered on arrears. */
    public const CPF_ARREARS = 'CPF Arr';

    public const PAST_ARREARS_FIELD_KEY = 'past_arrears';

    /** System field_key => label, applied to cirt_payroll_field_definitions. */
    public const FIELD_LABELS = [
        'da_arrears' => self::DA_ARREARS,
        'transport_arrears' => self::TRANSPORT_ARREARS,
        'gross_arrears' => self::GROSS_ARREARS,
        'net_arrears' => self::NET_ARREARS,
        'cpf_arrears' => self::CPF_ARREARS,
    ];
}
