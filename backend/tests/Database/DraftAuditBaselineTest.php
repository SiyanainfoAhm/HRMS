<?php

namespace Tests\Database;

use App\Models\HrmsActivityLogEntry;
use App\Models\HrmsUser;
use App\Services\ActivityLogService;
use App\Services\PayrollDraftService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * First save of a draft is audited against the row as calculated from Payroll Master (the baseline), exactly like later saves:
 * no empty-to-value dump, only typed edits and what they recalculated. Runs against a throwaway period inside the rolled-back
 * test transaction.
 */
final class DraftAuditBaselineTest extends DatabaseTestCase
{
    private const YEAR = 2031;
    private const MONTH = 6;

    private ActivityLogService $svc;
    private HrmsUser $admin;
    private string $company;
    private string $employee;
    private array $payload;

    protected function setUp(): void
    {
        parent::setUp();
        $this->svc = new ActivityLogService;
        $this->admin = HrmsUser::query()->where('role', 'admin')->first() ?? $this->markTestSkipped('No admin user.');
        $row = DB::table('cirt_payroll_draft_employees')->whereNotNull('row_payload')->orderByDesc('updated_at')->first();
        if (! $row) {
            $this->markTestSkipped('No saved draft row in the local database to use as a calculated payroll row.');
        }
        $this->payload = json_decode($row->row_payload, true);
        $this->employee = (string) $row->employee_user_id;
        $this->company = (string) DB::table('cirt_payroll_drafts')->where('id', $row->payroll_draft_id)->value('company_id');
        $this->payload['govRecalc']['electricityApplicable'] = true;
    }

    private function withUnits(int $units): array
    {
        $p = $this->payload;
        $p['govRecalc']['electricityUnitsConsumed'] = $units;
        $p['governmentMonthly']['electricityUnitsConsumed'] = $units;

        return $p;
    }

    private function request(array $employees): Request
    {
        $request = Request::create('api/v1/payroll/drafts', 'POST', ['year' => self::YEAR, 'month' => self::MONTH, 'employees' => $employees]);
        $admin = $this->admin;
        $request->setUserResolver(fn () => $admin);

        return $request;
    }

    private function save(array $payload, ?array $changed, bool $first): void
    {
        $version = $first ? null : (int) DB::table('cirt_payroll_drafts')->where('payroll_year', self::YEAR)->where('payroll_month', self::MONTH)->value('version');
        app(PayrollDraftService::class)->saveDraft($this->company, self::YEAR, self::MONTH, (string) $this->admin->id, [[
            'employeeUserId' => $this->employee, 'rowPayload' => $payload, ...($changed ? ['changedFields' => $changed] : []),
        ]], $version, $first);
    }

    /** @return list<array<string, mixed>> */
    private function newEntryRows(int $before): array
    {
        if (HrmsActivityLogEntry::query()->count() === $before) {
            return [];
        }
        $entry = HrmsActivityLogEntry::query()->orderByRaw('performed_at desc, ctid desc')->firstOrFail();

        return DB::table('cirt_activity_log_details')->where('entry_id', $entry->id)->orderBy('sort_order')->get()
            ->map(fn ($d) => ['item' => $d->changed_item, 'old' => $d->previous_value, 'new' => $d->updated_value, 'kind' => $d->change_kind])->all();
    }

    public function test_first_save_with_no_edits_logs_nothing(): void
    {
        $this->save($this->payload, null, true);
        $count = HrmsActivityLogEntry::query()->count();
        $row = ['employeeUserId' => $this->employee, 'rowPayload' => $this->payload]; // no baselineRow: the row was never touched
        $this->svc->recordRequest($this->request([$row]), new JsonResponse([], 200), null, []);

        $this->assertSame([], $this->newEntryRows($count), 'no empty-to-value dump on an untouched first save');
    }

    public function test_first_save_with_only_units_changed_logs_one_typed_change_and_what_it_recalculated(): void
    {
        $baseline = $this->withUnits(10);
        $edited = $this->withUnits(30);
        $this->save($edited, null, true);
        $count = HrmsActivityLogEntry::query()->count();
        $row = ['employeeUserId' => $this->employee, 'changedFields' => ['electricityUnitsConsumed'], 'rowPayload' => $edited,
            'baselineRow' => ['payDays' => $baseline['payDays'] ?? null, 'rowPayload' => $baseline]];
        $this->svc->recordRequest($this->request([$row]), new JsonResponse([], 200), null, []);

        $rows = $this->newEntryRows($count);
        $items = array_column($rows, 'item');
        $typed = array_filter($rows, fn ($r) => $r['kind'] === 'typed');
        $this->assertNotEmpty($rows, 'the edit is logged');
        $this->assertLessThan(40, count($rows), 'a handful of lines, never a full dump of the row: '.json_encode($items));
        $this->assertCount(1, $typed, 'exactly one typed change (Units): '.json_encode($items));
        foreach (['Employee Code', 'Department', 'Division', 'Designation', 'Payroll Mode', 'Pay Level', 'Date of Joining', 'Pay Days', 'Gross Arrears'] as $unchanged) {
            $this->assertNotContains($unchanged, $items, "$unchanged came unchanged from Payroll Master or is unrelated to units");
        }
        foreach ($rows as $r) {
            $this->assertContains($r['kind'], ['typed', 'recalculated']);
        }
    }

    public function test_editing_units_does_not_change_gross_arrears_or_other_unrelated_fields(): void
    {
        $this->save($this->withUnits(10), null, true);
        $before = DB::table('cirt_payroll_draft_employees')->where('employee_user_id', $this->employee)->first();
        $this->save($this->withUnits(30), ['electricityUnitsConsumed'], false);
        $after = DB::table('cirt_payroll_draft_employees')->where('employee_user_id', $this->employee)->first();

        $b = json_decode($before->row_payload, true);
        $a = json_decode($after->row_payload, true);
        foreach (['grossArrear', 'daArrearsPaid', 'transportArrearsPaid', 'cpfArrear', 'netArrear', 'basicPaid', 'daPaid', 'hraPaid', 'quarterRent'] as $key) {
            $this->assertEquals($b['governmentMonthly'][$key] ?? null, $a['governmentMonthly'][$key] ?? null, "$key must not change when only units change");
        }
        $this->assertEquals($b['grossArrear'] ?? null, $a['grossArrear'] ?? null, 'row-level Gross Arrears unchanged');
    }

    public function test_second_save_still_compares_with_the_first_save(): void
    {
        $this->save($this->withUnits(30), null, true);
        $savedFirst = (new \ReflectionMethod(ActivityLogService::class, 'savedDraftValues'))->invoke($this->svc, $this->company, self::YEAR, self::MONTH, $this->employee);
        $this->save($this->withUnits(50), ['electricityUnitsConsumed'], false);
        $count = HrmsActivityLogEntry::query()->count();
        $row = ['employeeUserId' => $this->employee, 'changedFields' => ['electricityUnitsConsumed'], 'rowPayload' => $this->withUnits(50)];
        $this->svc->recordRequest($this->request([$row]), new JsonResponse([], 200), null, [$this->employee => $savedFirst]);

        $rows = $this->newEntryRows($count);
        $units = array_values(array_filter($rows, fn ($r) => $r['kind'] === 'typed'));
        $this->assertCount(1, $units, json_encode(array_column($rows, 'item')));
        $this->assertSame(['30', '50'], [$units[0]['old'], $units[0]['new']], 'second save: previous value is the first save');
    }

    public function test_equal_looking_values_are_not_changes(): void
    {
        $m = new \ReflectionMethod(ActivityLogService::class, 'changedPayloadValues');
        [$fields] = $m->invoke($this->svc, ['units' => 30, 'a' => 0, 'b' => null, 'c' => 0.0, 'd' => ''], ['units' => '30', 'a' => null, 'b' => '—', 'c' => '0', 'd' => 0]);
        $this->assertSame([], $fields, '30 vs "30", and 0 / null / dash are all "nothing"');
    }
}
