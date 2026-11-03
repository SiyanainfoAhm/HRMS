<?php

namespace App\Services;

use App\Models\HrmsPayrollFieldDefinition;
use App\Support\PayrollExportTotals;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

/**
 * Shared by the multi-period TDS Data and Export Employee Payroll reports: which months can be picked
 * (a generated/finalized run exists), month-list parsing, and which custom-field columns to show.
 */
final class PeriodReportService
{
    public const MAX_MONTHS = 120;

    /** Keys that already have their own fixed column in Export Employee Payroll. */
    public const EMPLOYEE_FIXED_CUSTOM = ['telephone_allowance', 'gpf'];

    /** @return list<array{ym: string, year: int, month: int, label: string, periodId: string}> */
    public function periods(string $companyId): array
    {
        $rows = DB::table('cirt_monthly_payroll')->where('company_id', $companyId)
            ->selectRaw("to_char(month_year, 'YYYY-MM') as ym, min(payroll_period_id::text) as period_id")
            ->groupBy('ym')->orderBy('ym')->get();

        return $rows->map(fn ($r) => [
            'ym' => (string) $r->ym,
            'year' => (int) substr((string) $r->ym, 0, 4),
            'month' => (int) substr((string) $r->ym, 5, 2),
            'label' => Carbon::createFromFormat('!Y-m', (string) $r->ym)->format('F Y'),
            'periodId' => (string) $r->period_id,
        ])->values()->all();
    }

    /**
     * "2026-05,2026-06" (or an array) -> sorted unique list of YYYY-MM. Aborts 422 on a bad value.
     *
     * @return list<string>
     */
    public function parseMonths(mixed $input): array
    {
        $items = is_array($input) ? $input : array_filter(array_map('trim', explode(',', (string) $input)));
        $out = [];
        foreach ($items as $item) {
            $item = trim((string) $item);
            if (! preg_match('/^(20\d{2}|2100)-(0[1-9]|1[0-2])$/', $item)) {
                abort(422, "Invalid month '{$item}'. Use YYYY-MM.");
            }
            $out[$item] = true;
        }
        $months = array_keys($out);
        sort($months);
        abort_if($months === [], 422, 'Select at least one payroll month.');
        abort_if(count($months) > self::MAX_MONTHS, 422, 'Select at most '.self::MAX_MONTHS.' months.');

        return $months;
    }

    /**
     * Months that are really generated; draft-only months are never selectable.
     *
     * @param  list<string>  $months
     * @return list<string> periods' ids in month order
     */
    public function periodIdsFor(string $companyId, array $months): array
    {
        $generated = [];
        foreach ($this->periods($companyId) as $p) $generated[$p['ym']] = $p['periodId'];
        $ids = [];
        foreach ($months as $ym) {
            abort_unless(isset($generated[$ym]), 422, "No generated payroll exists for {$ym}.");
            $ids[] = $generated[$ym];
        }

        return $ids;
    }

    /** "2026-05" .. "2026-09" -> file-name part ("2026-05" when a single month). @param list<string> $months */
    public static function rangeLabel(array $months): string
    {
        $first = $months[0];
        $last = $months[count($months) - 1];

        return $first === $last ? $first : "{$first}_to_{$last}";
    }

    /**
     * One column per custom earning / deduction defined in Settings. Active definitions always show;
     * an inactive one (or a key with no definition at all) shows only when a selected row holds a
     * non-zero value, so no saved amount is silently dropped. Future definitions appear on their own.
     *
     * @param  iterable<array{0: mixed, 1: mixed}>  $bags  [custom_earnings, custom_deductions] of every selected row
     * @param  list<string>  $exclude  keys that already have a fixed column
     * @return array{earnings: array<string, string>, deductions: array<string, string>} field_key => label
     */
    public function customColumns(string $companyId, iterable $bags, array $exclude = []): array
    {
        $used = ['earnings' => [], 'deductions' => []];
        foreach ($bags as [$earn, $ded]) {
            foreach (PayrollExportTotals::bag($earn) as $k => $v) if (abs($v) > 0.004) $used['earnings'][$k] = true;
            foreach (PayrollExportTotals::bag($ded) as $k => $v) if (abs($v) > 0.004) $used['deductions'][$k] = true;
        }
        $defs = HrmsPayrollFieldDefinition::query()->where('company_id', $companyId)
            ->where(function ($q): void {
                $q->where('is_system', false)->orWhere('field_key', 'telephone_allowance');
            })
            ->whereIn('field_group', ['earnings', 'deductions', 'statutory'])
            ->orderBy('display_order')->orderBy('field_label')->get();

        $out = ['earnings' => [], 'deductions' => []];
        foreach ($defs as $def) {
            $side = $def->field_group === 'earnings' ? 'earnings' : 'deductions';
            $key = (string) $def->field_key;
            if (in_array($key, $exclude, true)) continue;
            if ($def->is_active || isset($used[$side][$key])) $out[$side][$key] = (string) $def->field_label;
        }
        foreach (['earnings', 'deductions'] as $side) {
            $extra = array_diff(array_keys($used[$side]), array_keys($out[$side]), $exclude);
            natcasesort($extra);
            foreach ($extra as $key) $out[$side][$key] = (string) $key;
        }

        return $out;
    }
}
