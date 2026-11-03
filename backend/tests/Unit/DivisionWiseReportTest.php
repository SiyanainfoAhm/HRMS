<?php

namespace Tests\Unit;

use App\Services\PostPayrollDownloadService;
use App\Support\SpreadsheetLayout;
use PHPUnit\Framework\TestCase;
use PhpOffice\PhpSpreadsheet\Cell\DataType;
use PhpOffice\PhpSpreadsheet\IOFactory;
use PhpOffice\PhpSpreadsheet\Spreadsheet;

/**
 * Division-Wise Salary: the real division names with the employees under them, subtotals, a grand total that equals the
 * month total, and a preview that is exactly the Excel sheet. Built from synthetic saved payroll rows: no database.
 */
final class DivisionWiseReportTest extends TestCase
{
    private PostPayrollDownloadService $svc;

    protected function setUp(): void
    {
        $this->svc = new PostPayrollDownloadService;
    }

    /** One saved monthly payroll row, as PostPayrollDownloadService::rows() returns it. */
    private function row(string $code, string $name, ?string $saved, ?string $masterDivision, int $gross = 50000, int $ded = 8000, string $month = '2026-09', int $level = 8): array
    {
        return [
            'employee_user_id' => 'u-'.$code, 'month_year' => $month.'-01', '_ym' => (int) str_replace('-', '', $month), 'pay_level' => $level,
            'division_name' => $saved, 'designation_name' => null, 'cpf_amount' => 5000,
            'total_earnings' => $gross, 'total_deductions' => $ded, 'net_salary' => $gross - $ded,
            '_master' => ['employee_code' => $code, 'name' => $name, 'designation' => 'Officer', 'division' => $masterDivision],
            '_user' => [],
        ];
    }

    /** @return array<string, list<list<mixed>>> division => its detail rows */
    private function byDivision(array $t): array
    {
        $out = [];
        foreach ($t['rows'] as $i => $r) {
            if ($t['kinds'][$i] === 'detail') $out[$r[0]][] = $r;
        }

        return $out;
    }

    public function test_a_new_division_with_two_employees_appears_with_names_and_totals(): void
    {
        $rows = [
            $this->row('002', 'Beta Person', 'Quantum Lab', 'Quantum Lab', 60000, 9000),
            $this->row('001', 'Alpha Person', 'Quantum Lab', 'Quantum Lab', 40000, 6000),
            $this->row('003', 'Other Person', 'Accounts', 'Accounts', 30000, 4000),
        ];
        $t = $this->svc->divisionWiseTable($rows, []); // Settings has not been read: the saved name is enough
        $groups = $this->byDivision($t);
        $this->assertSame(['Accounts', 'Quantum Lab'], array_keys($groups), 'alphabetical');
        $this->assertSame(['001', '002'], array_column($groups['Quantum Lab'], 1), 'employees in employee-code order');
        $this->assertSame(['Alpha Person', 'Beta Person'], array_column($groups['Quantum Lab'], 2));
        $subtotal = array_values(array_filter($t['rows'], fn ($r) => $r[0] === 'Quantum Lab - Subtotal'))[0];
        $this->assertSame([100000.0, 15000.0, 85000.0, 10000.0], array_slice($subtotal, 8, 4));
        $this->assertSame('2 employees', $subtotal[2]);
        $this->assertSame(['Grand Total', 130000.0, 19000.0, 111000.0, 15000.0], [$t['totals'][0], ...array_slice($t['totals'], 8, 4)]);
        $this->assertSame('3 employees', $t['totals'][2]);
        $this->assertSame(['Accounts', 'Alpha Person'], [$groups['Accounts'][0][0], $groups['Quantum Lab'][0][2]]);
    }

    public function test_blank_or_unusable_division_goes_to_unassigned_and_is_listed_last(): void
    {
        $rows = [
            $this->row('001', 'A', null, null),
            $this->row('002', 'B', '   ', ''),
            $this->row('003', 'C', '3f2b8e0a-1c4d-4e5f-9a6b-7c8d9e0f1a2b', null), // an id is not a name
            $this->row('004', 'D', '12', null), // neither is a code
            $this->row('005', 'E', 'Zeta Wing', 'Zeta Wing'),
            $this->row('006', 'F', null, 'Master Fallback'), // no saved name: the Master's division
        ];
        $groups = $this->byDivision($this->svc->divisionWiseTable($rows));
        $this->assertSame(['Master Fallback', 'Zeta Wing', 'Unassigned'], array_keys($groups));
        $this->assertSame(['001', '002', '003', '004'], array_column($groups['Unassigned'], 1));
    }

    public function test_names_match_trimmed_and_case_insensitive_so_one_division_never_splits(): void
    {
        $rows = [
            $this->row('001', 'A', 'Accounts ', null),
            $this->row('002', 'B', 'accounts', null),
            $this->row('003', 'C', "ACCOUNTS\u{00A0}", null),
            $this->row('004', 'D', 'Account  s', null), // a different word, stays separate
        ];
        $t = $this->svc->divisionWiseTable($rows, ['Accounts']);
        $groups = $this->byDivision($t);
        $this->assertSame(['Account s', 'Accounts'], array_keys($groups));
        $this->assertCount(3, $groups['Accounts'], 'one division, Settings spelling');
    }

    public function test_a_rename_shows_the_new_name_for_new_months_and_the_saved_name_for_old_months(): void
    {
        $rows = [
            $this->row('001', 'A', 'Old Name', 'New Name', 50000, 8000, '2026-08'),   // generated before the rename
            $this->row('001', 'A', 'New Name', 'New Name', 52000, 8000, '2026-09'),   // generated after it
            $this->row('002', 'B', null, 'New Name', 40000, 5000, '2026-09'),          // no saved name: Master (already renamed)
        ];
        $t = $this->svc->divisionWiseTable($rows, ['New Name']);
        $groups = $this->byDivision($t);
        $this->assertSame(['New Name', 'Old Name'], array_keys($groups));
        $this->assertSame(['August 2026'], array_column($groups['Old Name'], 5));
        $this->assertSame(['September 2026', 'September 2026'], array_column($groups['New Name'], 5));
        $this->assertSame('1 employee', array_values(array_filter($t['rows'], fn ($r) => $r[0] === 'Old Name - Subtotal'))[0][2]);
        $this->assertSame('2 employees', array_values(array_filter($t['rows'], fn ($r) => $r[0] === 'New Name - Subtotal'))[0][2]);
        $both = $this->svc->divisionWiseTable([$this->row('001', 'A', 'Same', null, 1, 0, '2026-08'), $this->row('001', 'A', 'Same', null, 1, 0, '2026-09')]);
        $this->assertSame('1 employee, 2 employee-months', $both['totals'][2]);
    }

    public function test_divisions_add_up_to_the_month_total_and_it_fails_loudly_when_they_do_not(): void
    {
        $rows = [];
        foreach (['Accounts', 'Admin', null, 'Quantum Lab'] as $i => $d) {
            for ($k = 1; $k <= 3; $k++) $rows[] = $this->row("{$i}{$k}", "E{$i}{$k}", $d, null, 41234 + $i * 1000 + $k, 7001 + $k);
        }
        $t = $this->svc->divisionWiseTable($rows);
        $sum = fn (string $k) => array_sum(array_map(fn ($r) => $r[$k], $rows));
        $this->assertSame((float) $sum('total_earnings'), $t['totals'][8]);
        $this->assertSame((float) $sum('total_deductions'), $t['totals'][9]);
        $this->assertSame((float) $sum('net_salary'), $t['totals'][10]);
        $this->assertSame(12, array_sum(array_column($t['divisions'], 'rows')));
        $this->assertSame($t['totals'][8] - $t['totals'][9], $t['totals'][10], 'gross - deductions = net');
        foreach ($t['rows'] as $r) $this->assertTrue($r[8] === null || floor($r[8]) === $r[8], 'whole rupees');

        // A row whose amount is paise is rounded once per line (whole-rupee rule): the sums still tie exactly.
        $paise = [$this->row('1', 'A', 'X', null, 1000, 0), $this->row('2', 'B', 'Y', null, 1000, 0)];
        $paise[0]['total_earnings'] = 1000.5;
        $paise[1]['total_earnings'] = 1000.4;
        $p = $this->svc->divisionWiseTable($paise);
        $this->assertSame(2001.0, $p['totals'][8]);
    }

    public function test_preview_table_is_exactly_the_excel_sheet(): void
    {
        $rows = [
            $this->row('001', 'Alpha', 'Quantum Lab', null, 60000, 9000, '2026-08', 12),
            $this->row('001', 'Alpha', 'Quantum Lab', null, 61000, 9000, '2026-09', 12),
            $this->row('020', 'Gamma', null, null, 30000, 4000, '2026-09', 3),
        ];
        $t = $this->svc->divisionWiseTable($rows);
        $path = $this->svc->save($this->svc->buildDivisionWise($rows));
        $ws = IOFactory::load($path)->getSheetByName('Division-Wise');
        unlink($path);

        $excel = [];
        foreach ($ws->toArray(null, true, false, false) as $r) $excel[] = array_map(fn ($v) => $v === '' ? null : $v, $r);
        $preview = array_merge([$t['headers']], $t['rows'], [$t['totals']]);
        $norm = fn (array $r) => array_map(fn ($v) => $v === '' ? null : (is_numeric($v) ? (float) $v : $v), $r);
        $this->assertSame(array_map($norm, $preview), array_map($norm, $excel), 'every preview row (headers, details, subtotals, grand total) equals the Excel row');

        $this->assertSame([], SpreadsheetLayout::badHeaders($t['headers']));
        $this->assertSame([], SpreadsheetLayout::auditHeaders($ws->getParent(), ['Division-Wise' => 1]));
        // Year / code formats as fixed in the Excel clean-up.
        $this->assertSame('0', $ws->getStyle('G2')->getNumberFormat()->getFormatCode());
        $this->assertSame('2026', $ws->getCell('G2')->getFormattedValue());
        $this->assertSame('0', $ws->getStyle('E2')->getNumberFormat()->getFormatCode(), 'Pay Level');
        $this->assertSame(DataType::TYPE_STRING, $ws->getCell('B2')->getDataType(), 'Employee Code is text');
        $this->assertSame('D2', $ws->getFreezePane());
        $this->assertTrue((bool) $ws->getStyle('A4')->getFont()->getBold(), 'subtotal row is bold');
        $this->assertSame('Grand Total', $ws->getCell('A'.$ws->getHighestDataRow())->getValue());
        $this->assertSame(SpreadsheetLayout::FORMAT_AMOUNT, $ws->getStyle('I2')->getNumberFormat()->getFormatCode());
    }

    public function test_single_month_workbook_keeps_the_monthly_summaries_with_real_division_names_and_multi_month_does_not(): void
    {
        $single = [$this->row('001', 'A', 'Quantum Lab', null), $this->row('002', 'B', 'Accounts', null), $this->row('003', 'C', null, null)];
        $wb = $this->svc->buildDivisionWise($single, 202609, []);
        $this->assertSame(['Division-Wise', 'Division', 'Count', 'Pay Level'], $wb->getSheetNames());
        $names = fn (Spreadsheet $b, string $sheet, int $from, int $to) => array_filter(array_map(fn ($r) => $b->getSheetByName($sheet)->getCell('A'.$r)->getValue(), range($from, $to)));
        $this->assertSame(['Accounts', 'Quantum Lab', 'Unassigned', 'TOTAL', 'GRAND TOTAL'], array_values($names($wb, 'Division', 5, 10)));
        $this->assertSame(['Accounts', 'Quantum Lab', 'Unassigned'], array_values(array_filter($names($wb, 'Count', 5, 9), fn ($v) => $v !== 'TOTAL')));
        $this->assertSame([], SpreadsheetLayout::auditHeaders($wb, ['Division' => 3, 'Count' => 4, 'Pay Level' => 6]));

        $multi = [...$single, $this->row('001', 'A', 'Quantum Lab', null, 50000, 8000, '2026-10')];
        $this->assertSame(['Division-Wise'], $this->svc->buildDivisionWise($multi)->getSheetNames());
    }

    public function test_no_rows_still_builds_a_valid_sheet(): void
    {
        $t = $this->svc->divisionWiseTable([]);
        $this->assertSame([], $t['rows']);
        $this->assertSame(['Division-Wise'], $this->svc->buildDivisionWise([])->getSheetNames());
    }
}
