<?php

namespace Tests\Database;

use App\Http\Controllers\Api\V1\ActivityLogController;
use App\Models\HrmsActivityLogEntry;
use App\Models\HrmsUser;
use App\Services\ActivityLogService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * CIRT-10: one main record per action, child detail rows stored once, old rows still readable.
 */
final class ActivityEntriesTest extends DatabaseTestCase
{
    use FinalizedPayrollSnapshot;

    private function admin(): HrmsUser
    {
        $user = HrmsUser::query()->where('role', 'admin')->first();
        $user !== null || $this->markTestSkipped('No admin user in the local database.');

        return $user;
    }

    private function request(string $method, string $uri, array $body, HrmsUser $user): Request
    {
        $request = Request::create($uri, $method, $body);
        $request->setUserResolver(fn () => $user);

        return $request;
    }

    private function rowsFor(HrmsActivityLogEntry $entry): array
    {
        return DB::table('cirt_activity_log_details')->where('entry_id', $entry->id)->orderBy('sort_order')->get()
            ->map(fn ($d) => [$d->employee_user_id, $d->changed_item, $d->previous_value, $d->updated_value])->all();
    }

    public function test_bulk_draft_save_is_one_main_record_with_only_relevant_detail_rows(): void
    {
        $admin = $this->admin();
        $emp = $this->sampleEmployees(3)['users'];
        $legacyBefore = DB::table('cirt_activity_logs')->count();
        $entriesBefore = HrmsActivityLogEntry::query()->count();

        $row = fn (string $id, int $mess, float $units, int $credit) => [
            'employeeUserId' => $id,
            'rowPayload' => ['governmentMonthly' => [
                'deductions' => ['mess' => $mess, 'creditSociety' => $credit, 'electricity' => 711],
                'electricityUnitsConsumed' => $units, 'totalDeductions' => 5000 + $mess, 'netSalary' => 40000 - $mess,
            ]],
            'payDays' => 30, 'netPay' => 40000 - $mess,
        ];
        $draftBefore = [
            $emp[0] => (new \ReflectionMethod(ActivityLogService::class, 'draftRowValues'))->invoke(new ActivityLogService, $row($emp[0], 25, 49, 0)),
            $emp[1] => (new \ReflectionMethod(ActivityLogService::class, 'draftRowValues'))->invoke(new ActivityLogService, $row($emp[1], 25, 49, 0)),
            $emp[2] => (new \ReflectionMethod(ActivityLogService::class, 'draftRowValues'))->invoke(new ActivityLogService, $row($emp[2], 25, 49, 0)),
        ];
        // Employee 0 changes Mess, units and Credit Society; employee 1 changes only Mess; employee 2 nothing.
        $body = ['year' => 2026, 'month' => 12, 'employees' => [$row($emp[0], 40, 80, 500), $row($emp[1], 30, 49, 0), $row($emp[2], 25, 49, 0)]];
        $request = $this->request('POST', 'api/v1/payroll/drafts', $body, $admin);

        (new ActivityLogService)->recordRequest($request, new JsonResponse(['ok' => true], 200), null, $draftBefore);

        $this->assertSame($entriesBefore + 1, HrmsActivityLogEntry::query()->count(), 'one main record for the whole action');
        $this->assertSame($legacyBefore, DB::table('cirt_activity_logs')->count(), 'no per-employee legacy rows for this action');

        $entry = HrmsActivityLogEntry::query()->latest('performed_at')->first();
        $this->assertSame('Payroll Draft', $entry->action_label);
        $this->assertSame('Payroll', $entry->module);
        $this->assertSame($admin->name ?? $admin->email, $entry->performed_by_name);
        $this->assertSame(3, $entry->employee_count);

        $rows = $this->rowsFor($entry);
        $items = array_column($rows, 1);
        $this->assertContains('Mess Deduction', $items);
        $this->assertContains('Electricity Units', $items);
        $this->assertContains('Credit Society', $items);
        foreach (['Total Deductions', 'Net Salary', 'Net Pay'] as $derived) {
            $this->assertNotContains($derived, $items, "{$derived} is derived, not a relevant change");
        }
        $this->assertContains([$emp[0], 'Mess Deduction', '25', '40'], $rows);
        $this->assertContains([$emp[0], 'Electricity Units', '49', '80'], $rows);
        $this->assertContains([$emp[0], 'Credit Society', '0', '500'], $rows);
        $this->assertContains([$emp[1], 'Mess Deduction', '25', '30'], $rows);
        $this->assertSame([], array_filter($rows, fn ($r) => $r[0] === $emp[2]), 'unchanged employee has no detail rows');
        $this->assertSame(count($rows), (int) $entry->detail_count);
    }

    public function test_autosave_with_no_relevant_change_writes_nothing(): void
    {
        $admin = $this->admin();
        $emp = $this->sampleEmployees(1)['users'][0];
        $before = HrmsActivityLogEntry::query()->count();
        $same = ['employeeUserId' => $emp, 'rowPayload' => ['governmentMonthly' => ['deductions' => ['mess' => 25]]], 'payDays' => 30];
        $svc = new ActivityLogService;
        $values = (new \ReflectionMethod(ActivityLogService::class, 'draftRowValues'))->invoke($svc, $same);
        $svc->recordRequest($this->request('POST', 'api/v1/payroll/drafts', ['year' => 2026, 'month' => 12, 'employees' => [$same]], $admin), new JsonResponse([], 200), null, [$emp => $values]);

        $this->assertSame($before, HrmsActivityLogEntry::query()->count());
    }

    public function test_draft_reset_is_one_record(): void
    {
        $admin = $this->admin();
        $emp = $this->sampleEmployees(2)['users'];
        $before = HrmsActivityLogEntry::query()->count();
        (new ActivityLogService)->recordRequest(
            $this->request('DELETE', 'api/v1/payroll/drafts', ['year' => 2026, 'month' => 12], $admin),
            new JsonResponse(['ok' => true], 200), null, [$emp[0] => ['x' => 1], $emp[1] => ['x' => 1]],
        );
        $this->assertSame($before + 1, HrmsActivityLogEntry::query()->count());
        $entry = HrmsActivityLogEntry::query()->latest('performed_at')->first();
        $this->assertSame('Payroll Reset', $entry->action_label);
        $this->assertSame('Payroll', $entry->module);
        $this->assertSame([[null, 'Draft 12/2026', 'Saved draft (2 employee rows)', 'Reset to Master values']], $this->rowsFor($entry));
    }

    public function test_payroll_master_change_logs_previous_and_updated_values_once(): void
    {
        $admin = $this->admin();
        $master = DB::table('cirt_payroll_master')->whereNull('effective_to')->where('status', 'active')->first();
        $service = new ActivityLogService;
        $request = $this->request('PUT', 'api/v1/payroll/master/'.$master->id, ['messDefault' => 80], $admin);
        $request->setRouteResolver(fn () => null);
        $admin->company_id = $master->company_id;

        $before = $service->captureConfigurationSnapshot($request);
        $this->assertSame($master->employee_user_id, $before['__employee']);
        DB::table('cirt_payroll_master')->where('id', $master->id)->update(['mess_default' => 80, 'credit_society_default' => 1234, 'total_earnings' => 99999, 'take_home' => 88888, 'transport_total' => 7777]);
        $count = HrmsActivityLogEntry::query()->count();
        $service->recordRequest($request, new JsonResponse(['ok' => true], 200), $before, null);

        $this->assertSame($count + 1, HrmsActivityLogEntry::query()->count());
        $entry = HrmsActivityLogEntry::query()->latest('performed_at')->first();
        $this->assertSame('Payroll Master Change', $entry->action_label);
        $this->assertSame('Master', $entry->module);
        $rows = $this->rowsFor($entry);
        $items = array_column($rows, 1);
        $this->assertContains('Mess Deduction', $items);
        $this->assertContains('Credit Society', $items);
        foreach (['Total Earnings', 'Take Home', 'Transport Total'] as $derived) {
            $this->assertNotContains($derived, $items, "{$derived} is derived");
        }
        $mess =array_values(array_filter($rows, fn ($r) => $r[1] === 'Mess Deduction'))[0];
        $this->assertSame('80', $mess[3]);
    }

    public function test_configuration_change_and_non_mutating_master_preview(): void
    {
        $admin = $this->admin();
        $service = new ActivityLogService;
        $count = HrmsActivityLogEntry::query()->count();
        $service->recordRequest(
            $this->request('PUT', 'api/v1/settings/payroll-fields/a3088fdb-bb19-41b6-8051-db65e4672cde', ['showInRunPayroll' => false], $admin),
            new JsonResponse(['field' => ['field_label' => 'Mess', 'show_in_run_payroll' => false]], 200),
            ['field_label' => 'Mess', 'show_in_run_payroll' => true], null,
        );
        $this->assertSame($count + 1, HrmsActivityLogEntry::query()->count());
        $entry = HrmsActivityLogEntry::query()->latest('performed_at')->first();
        $this->assertSame('Earnings and Deductions Configuration Change', $entry->action_label);
        $this->assertSame('Configuration', $entry->module);
        $this->assertSame([[null, 'Mess: Show In Run Payroll', 'Yes', 'No']], $this->rowsFor($entry));

        // A read-only Master preview is not an activity.
        $service->recordRequest($this->request('POST', 'api/v1/payroll/master/preview', ['payLevel' => 7], $admin), new JsonResponse([], 200));
        $this->assertSame($count + 1, HrmsActivityLogEntry::query()->count());
    }

    public function test_api_lists_entries_with_date_time_module_and_details_and_legacy_rows_stay_readable(): void
    {
        $admin = $this->admin();
        $emp = $this->sampleEmployees(1)['users'][0];
        $service = new ActivityLogService;
        $service->recordRequest(
            $this->request('DELETE', 'api/v1/payroll/drafts', ['year' => 2026, 'month' => 12], $admin),
            new JsonResponse([], 200), null, [$emp => ['x' => 1]],
        );
        $legacy = DB::table('cirt_activity_logs')->count();

        $controller = new ActivityLogController;
        $list = $controller->entries($this->request('GET', 'api/v1/activity-logs/entries', ['module' => 'Payroll'], $admin))->getData(true);
        $first = $list['entries'][0];
        $this->assertSame(['id', 'action', 'actionCode', 'performedBy', 'date', 'time', 'performedAt', 'module', 'outcome', 'employeeCount', 'detailCount', 'payrollYear', 'payrollMonth', 'subject'], array_keys($first));
        $this->assertMatchesRegularExpression('/^\d{2}-\d{2}-\d{4}$/', $first['date']);
        $this->assertMatchesRegularExpression('/^\d{2}:\d{2}:\d{2}$/', $first['time']);
        $this->assertSame('Payroll', $first['module']);

        $detail = $controller->entryDetails($this->request('GET', 'x', [], $admin), $first['id'])->getData(true)['entry'];
        $this->assertSame(['employee', 'changedItem', 'previousValue', 'updatedValue', 'kind', 'diff'], array_keys($detail['details'][0]));

        // Old per-employee rows are untouched and the old endpoint still serves them.
        $this->assertSame($legacy, DB::table('cirt_activity_logs')->count());
        $old = $controller->index($this->request('GET', 'api/v1/activity-logs', [], $admin))->getData(true);
        $this->assertGreaterThan(0, $old['pagination']['total']);
        $this->assertSame([], array_diff(['eventId', 'timestamp', 'actor', 'action'], array_keys($old['events'][0])));
    }

    public function test_activity_entries_do_not_touch_finalized_payroll(): void
    {
        $snapshot = $this->finalizedSnapshot();
        $admin = $this->admin();
        (new ActivityLogService)->recordRequest(
            $this->request('DELETE', 'api/v1/payroll/drafts', ['year' => 2026, 'month' => 12], $admin),
            new JsonResponse([], 200), null, [],
        );
        $this->assertFinalizedUnchanged($snapshot, 'activity logging');
    }
}
