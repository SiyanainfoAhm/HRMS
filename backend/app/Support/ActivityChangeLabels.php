<?php

namespace App\Support;

use App\Services\PayrollAmendmentService;
use Illuminate\Support\Str;

/**
 * Turns raw changed paths (governmentMonthly.deductions.mess, mess_default, ...) into the
 * business labels shown in Activity Log "View Details", and drops derived/technical values
 * so only the relevant changes remain (CIRT-10).
 */
final class ActivityChangeLabels
{
    /** Last path segment => label. Takes precedence over the amendment labels. */
    private const SPECIAL = [
        'mess' => 'Mess Deduction', 'messDefault' => 'Mess Deduction', 'mess_default' => 'Mess Deduction',
        'creditSociety' => 'Credit Society', 'credit_society' => 'Credit Society', 'credit_society_default' => 'Credit Society',
        'creditSocietyDefault' => 'Credit Society',
        'electricity' => 'Electricity Deduction', 'electricity_default' => 'Electricity Deduction', 'electricityDefault' => 'Electricity Deduction',
        'electricityUnitsConsumed' => 'Electricity Units', 'electricity_units_consumed' => 'Electricity Units',
        'quarterRent' => 'Quarter Rent', 'quarter_rent' => 'Quarter Rent',
        'nightHours' => 'Night Duty Hours', 'night_hours' => 'Night Duty Hours',
        'grossArrear' => PayrollLabels::GROSS_ARREARS, 'gross_arrear' => PayrollLabels::GROSS_ARREARS,
        'cpfArrear' => PayrollLabels::CPF_ARREARS, 'cpf_arrear' => PayrollLabels::CPF_ARREARS,
        'daArrear' => PayrollLabels::DA_ARREARS, 'transportArrear' => PayrollLabels::TRANSPORT_ARREARS,
        'payDays' => 'Pay Days', 'remarks' => 'Remarks',
    ];

    /** Derived or technical values: never shown as a "change". */
    private const DERIVED = '/(^|\.)('
        .'total[A-Za-z_]*|[A-Za-z]+_total|[A-Za-z]+Total|net[A-Za-z_]*|takeHome|take_home|pfEmployee|pf_employee|cpf_effective|cpfEffective'
        .'|gross(Pay|Salary|Monthly|_pay|_salary)'
        .'|[A-Za-z]*Actual|[A-Za-z_]*_actual|version|updated_at|created_at|effective_(from|to)|status|id|[A-Za-z_]*_id|[A-Za-z]*Id'
        .'|[A-Za-z]*Warning|[A-Za-z]*Eligible|[A-Za-z]*Ceiling|[A-Za-z]*Basis|[A-Za-z]*_basis'
        .'|electricity(Tariff|Sthir|Consumption|Vahan|Fuel|Duty|Bill|Total|Applicable|Mode|UnitRate)[A-Za-z]*'
        .'|electricity_(tariff|sthir|consumption|vahan|fuel|duty|total|unit_rate|mode|applicable)[a-z_]*'
        .'|transportSlab[A-Za-z.]*|transport_slab[a-z_]*|govRecalc\..*'
        .')$/';

    public static function isRelevant(string $path): bool
    {
        return preg_match(self::DERIVED, $path) !== 1;
    }

    public static function label(string $path): string
    {
        $last = str_contains($path, '.') ? substr($path, (int) strrpos($path, '.') + 1) : $path;
        if (isset(self::SPECIAL[$last])) {
            return self::SPECIAL[$last];
        }
        if (isset(PayrollAmendmentService::FIELD_LABELS[$last])) {
            return PayrollAmendmentService::FIELD_LABELS[$last];
        }

        return Str::headline($last);
    }

    /** Value as shown in the details table (numbers trimmed, bools Yes/No, arrays as JSON). */
    public static function display(mixed $value): ?string
    {
        if ($value === null) return null;
        if (is_bool($value)) return $value ? 'Yes' : 'No';
        if (is_int($value)) return (string) $value;
        if (is_float($value) || (is_string($value) && is_numeric($value) && ! preg_match('/^0\d/', $value))) {
            $text = rtrim(rtrim(number_format((float) $value, 2, '.', ''), '0'), '.');

            return $text === '' ? '0' : $text;
        }
        if (is_array($value)) return json_encode($value, JSON_UNESCAPED_UNICODE);

        return (string) $value;
    }
}
