<?php

namespace Tests\Database;

use App\Http\Controllers\Api\V1\ActivityLogController;
use App\Models\HrmsActivityLogEntry;
use App\Models\HrmsUser;
use App\Services\ActivityLogService;
use App\Support\ActivityDiff;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Activity Log: ONE record per action, a details view with only what changed (old -> new, plain labels), compact JSON
 * diffs, no secrets, nothing when nothing changed. Everything runs inside the rolled-back test transaction.
 */
final class ActivityAuditTest extends DatabaseTestCase
{
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

    /** Runs the middleware sequence for one request: snapshot, the change, then the record. */
    private function audited(HrmsUser $user, string $method, string $uri, array $body, callable $change, mixed $response = null, int $status = 200): void
    {
        $svc = new ActivityLogService;
        $request = $this->request($method, $uri, $body, $user);
        $before = $svc->captureAuditBefore($request);
        $change();
        $svc->recordRequest($request, new JsonResponse($response ?? ['ok' => true], $status), null, null, $before);
    }

    private function latest(): HrmsActivityLogEntry
    {
        // Entries written in the same second tie on performed_at: insertion order decides.
        return HrmsActivityLogEntry::query()->orderByRaw('performed_at desc, ctid desc')->firstOrFail();
    }

    /** @return list<array<string, mixed>> */
    private function rows(HrmsActivityLogEntry $entry): array
    {
        return DB::table('cirt_activity_log_details')->where('entry_id', $entry->id)->orderBy('sort_order')->get()
            ->map(fn ($d) => ['employee' => $d->employee_label, 'item' => $d->changed_item, 'old' => $d->previous_value, 'new' => $d->updated_value,
                'kind' => $d->change_kind, 'diff' => $d->diff ? json_decode($d->diff, true) : null])->all();
    }

    private function entryCount(): int
    {
        return HrmsActivityLogEntry::query()->count();
    }

    public function test_draft_save_changing_only_electricity_logs_exactly_one_field_change(): void
    {
        $admin = $this->admin();
        $emp = $this->sampleEmployees(1)['users'][0];
        $svc = new ActivityLogService;
        $values = fn (int $el) => (new \ReflectionMethod(ActivityLogService::class, 'draftRowValues'))->invoke($svc, ['rowPayload' => ['governmentMonthly' => ['deductions' => ['electricity' => $el, 'mess' => 25]]], 'payDays' => 30]);
        $row = ['employeeUserId' => $emp, 'changedFields' => ['govDeduction_electricity'], 'payDays' => 30,
            'rowPayload' => ['governmentMonthly' => ['deductions' => ['electricity' => 98, 'mess' => 25]]]];
        $count = $this->entryCount();
        $svc->recordRequest($this->request('POST', 'api/v1/payroll/drafts', ['year' => 2026, 'month' => 10, 'employees' => [$row]], $admin), new JsonResponse([], 200), null, [$emp => $values(49)]);

        $this->assertSame($count + 1, $this->entryCount());
        $rows = $this->rows($this->latest());
        $this->assertCount(1, $rows, 'exactly one field change');
        $this->assertSame('Electricity Deduction', $rows[0]['item']);
        $this->assertSame(['49', '98'], [$rows[0]['old'], $rows[0]['new']]);
        $this->assertSame('typed', $rows[0]['kind']);
        $this->assertEquals(['field' => 'governmentMonthly.deductions.electricity', 'old' => 49, 'new' => 98, 'type' => 'money'], $rows[0]['diff']);
        $this->assertNotNull($rows[0]['employee']);
    }

    public function test_typed_changes_stay_distinct_from_recalculated_ones_and_totals_are_one_compact_line(): void
    {
        $admin = $this->admin();
        $emp = $this->sampleEmployees(1)['users'][0];
        $svc = new ActivityLogService;
        $values = fn (array $gm, int $earn, int $net) => (new \ReflectionMethod(ActivityLogService::class, 'draftRowValues'))->invoke($svc, [
            'rowPayload' => ['governmentMonthly' => $gm], 'payDays' => 30, 'totalEarnings' => $earn, 'netPay' => $net, 'totalDeductions' => 1000]);
        $before = $values(['nightHours' => 0, 'deductions' => ['electricity' => 49]], 50000, 49000);
        $row = ['employeeUserId' => $emp, 'changedFields' => ['nightHours'], 'payDays' => 30, 'totalEarnings' => 50300, 'netPay' => 49300, 'totalDeductions' => 1000,
            'rowPayload' => ['governmentMonthly' => ['nightHours' => 120, 'deductions' => ['electricity' => 98]]]];
        $svc->recordRequest($this->request('POST', 'api/v1/payroll/drafts', ['year' => 2026, 'month' => 10, 'employees' => [$row]], $admin), new JsonResponse([], 200), null, [$emp => $before]);
        $rows = $this->rows($this->latest());
        $byItem = array_column($rows, null, 'item');
        $this->assertSame(['0', '120'], [$byItem['Night Duty Hours']['old'], $byItem['Night Duty Hours']['new']]);
        $this->assertSame('typed', $byItem['Night Duty Hours']['kind']);
        $this->assertSame('recalculated', $byItem['Electricity Deduction (recalculated)']['kind']);
        $this->assertSame('recalculated', $byItem['Totals recalculated']['kind']);
        $this->assertSame('Gross 50,000 · Net pay 49,000', $byItem['Totals recalculated']['old']);
        $this->assertCount(3, $rows, 'typed + recalculated + one compact totals line, never a dump');
    }

    public function test_draft_save_with_no_change_logs_nothing(): void
    {
        $admin = $this->admin();
        $emp = $this->sampleEmployees(1)['users'][0];
        $svc = new ActivityLogService;
        $same = ['employeeUserId' => $emp, 'payDays' => 30, 'rowPayload' => ['governmentMonthly' => ['deductions' => ['electricity' => 49]]]];
        $vals = (new \ReflectionMethod(ActivityLogService::class, 'draftRowValues'))->invoke($svc, $same);
        $count = $this->entryCount();
        $svc->recordRequest($this->request('POST', 'api/v1/payroll/drafts', ['year' => 2026, 'month' => 10, 'employees' => [$same]], $admin), new JsonResponse([], 200), null, [$emp => $vals]);
        $this->assertSame($count, $this->entryCount());
    }

    public function test_settings_da_change_logs_old_new_and_effective_date(): void
    {
        $admin = $this->admin();
        $company = $admin->company_id;
        $old = (float) DB::table('cirt_institute')->where('id', $company)->value('default_da_percent');
        $count = $this->entryCount();
        $this->audited($admin, 'PUT', 'api/v1/company/me', ['default_da_percent' => $old + 1, 'payroll_revision_effective_from' => '2026-11-01'],
            fn () => DB::table('cirt_institute')->where('id', $company)->update(['default_da_percent' => $old + 1]));
        $this->assertSame($count + 1, $this->entryCount());
        $entry = $this->latest();
        $this->assertSame('Settings', $entry->module);
        $this->assertSame('Company settings Updated', $entry->action_label);
        $rows = $this->rows($entry);
        $da = array_values(array_filter($rows, fn ($r) => $r['item'] === 'DA %'))[0];
        $this->assertSame([rtrim(rtrim(number_format($old, 2, '.', ''), '0'), '.').'%', rtrim(rtrim(number_format($old + 1, 2, '.', ''), '0'), '.').'%'], [$da['old'], $da['new']]);
        $this->assertSame(['default_da_percent', 'percent'], [$da['diff']['field'], $da['diff']['type']]);
        $effective = array_values(array_filter($rows, fn ($r) => $r['item'] === 'Effective from'))[0];
        $this->assertSame('01/11/2026', $effective['new']);
        $this->assertCount(2, $rows, 'only the DA change and its effective date');
        // The same save again changes nothing: no entry.
        $count = $this->entryCount();
        $this->audited($admin, 'PUT', 'api/v1/company/me', ['default_da_percent' => $old + 1], fn () => null);
        $this->assertSame($count, $this->entryCount());
    }

    public function test_quarter_assign_change_and_release_are_one_labelled_record_each(): void
    {
        $admin = $this->admin();
        $company = $admin->company_id;
        $emp = $this->sampleEmployees(1)['users'][0];
        DB::table('cirt_quarters')->where('assigned_employee_id', $emp)->update(['assigned_employee_id' => null, 'status' => 'available']);
        $q1 = (string) Str::uuid();
        $q2 = (string) Str::uuid();
        foreach ([[$q1, 'QT-OLD', 'Type A', 400], [$q2, 'QT-NEW', 'Type B', 640]] as [$id, $name, $type, $rent]) {
            DB::table('cirt_quarters')->insert(['id' => $id, 'company_id' => $company, 'quarter_name' => $name, 'quarter_type' => $type, 'monthly_rent' => $rent, 'status' => 'available']);
        }
        $assign = fn (string $id) => fn () => DB::table('cirt_quarters')->where('id', $id)->update(['assigned_employee_id' => $emp, 'status' => 'assigned', 'assigned_from' => date('Y-m-d')]);
        $release = fn (string $id) => fn () => DB::table('cirt_quarters')->where('id', $id)->update(['assigned_employee_id' => null, 'status' => 'available', 'assigned_to' => date('Y-m-d')]);

        $count = $this->entryCount();
        $this->audited($admin, 'POST', "api/v1/settings/quarters/{$q1}/assign", ['employee_user_id' => $emp], $assign($q1));
        $this->assertSame($count + 1, $this->entryCount(), 'assign: one record');
        $entry = $this->latest();
        $this->assertSame('Quarter Assigned', $entry->action_label);
        $this->assertSame('Quarters', $entry->module);
        $rows = $this->rows($entry);
        $this->assertSame([null, 'QT-OLD (Type A)'], [array_values(array_filter($rows, fn ($r) => $r['item'] === 'Quarter'))[0]['old'], array_values(array_filter($rows, fn ($r) => $r['item'] === 'Quarter'))[0]['new']]);
        $this->assertContains('Monthly rent', array_column($rows, 'item'));
        $this->assertContains('Assigned from', array_column($rows, 'item'));
        $this->assertNotNull($rows[0]['employee'], 'the employee is named');

        // Change quarter: the employee leaves QT-OLD for QT-NEW (release, then assign: previous quarter is shown).
        $this->audited($admin, 'POST', "api/v1/settings/quarters/{$q1}/unassign", [], $release($q1));
        $this->assertSame('Quarter Released', $this->latest()->action_label);
        $rel = array_values(array_filter($this->rows($this->latest()), fn ($r) => $r['item'] === 'Quarter'))[0];
        $this->assertSame(['QT-OLD (Type A)', 'Released'], [$rel['old'], $rel['new']]);
        DB::table('cirt_quarters')->where('id', $q1)->update(['assigned_employee_id' => $emp, 'status' => 'assigned']);
        $this->audited($admin, 'POST', "api/v1/settings/quarters/{$q2}/assign", ['employee_user_id' => $emp], function () use ($q1, $q2, $emp): void {
            DB::table('cirt_quarters')->where('id', $q1)->update(['assigned_employee_id' => null, 'status' => 'available']);
            DB::table('cirt_quarters')->where('id', $q2)->update(['assigned_employee_id' => $emp, 'status' => 'assigned', 'assigned_from' => date('Y-m-d')]);
        });
        $chg = array_values(array_filter($this->rows($this->latest()), fn ($r) => $r['item'] === 'Quarter'))[0];
        $this->assertSame(['QT-OLD (Type A)', 'QT-NEW (Type B)'], [$chg['old'], $chg['new']], 'previous and new quarter');

        // Rent change on the catalog quarter.
        $count = $this->entryCount();
        $this->audited($admin, 'PUT', "api/v1/settings/quarters/{$q2}", ['monthly_rent' => 700], fn () => DB::table('cirt_quarters')->where('id', $q2)->update(['monthly_rent' => 700]));
        $this->assertSame($count + 1, $this->entryCount());
        $rent = $this->rows($this->latest());
        $this->assertSame([['Monthly rent', '640', '700']], array_map(fn ($r) => [$r['item'], $r['old'], $r['new']], $rent));
        // Deactivate the quarter.
        $this->audited($admin, 'POST', "api/v1/settings/quarters/{$q2}/deactivate", [], fn () => DB::table('cirt_quarters')->where('id', $q2)->update(['status' => 'inactive']));
        $this->assertSame('Quarter Deactivated', $this->latest()->action_label);
        $this->assertSame([['Status', 'assigned', 'inactive']], array_map(fn ($r) => [$r['item'], $r['old'], $r['new']], $this->rows($this->latest())));
    }

    public function test_payroll_field_create_edit_and_deactivate(): void
    {
        $admin = $this->admin();
        $company = $admin->company_id;
        $id = (string) Str::uuid();
        $count = $this->entryCount();
        $this->audited($admin, 'POST', 'api/v1/settings/payroll-fields', ['field_label' => 'Special Duty'], function () use ($id, $company): void {
            DB::table('cirt_payroll_field_definitions')->insert([
                'id' => $id, 'company_id' => $company, 'field_label' => 'Special Duty', 'field_key' => 'special_duty_t', 'field_group' => 'earnings', 'field_type' => 'number',
                'calculation_type' => 'manual_entry', 'is_required' => false, 'show_in_payroll_master' => true, 'show_in_run_payroll' => true, 'show_in_salary_slip' => true,
                'include_in_total_earnings' => true, 'include_in_total_deductions' => false, 'is_system' => false, 'is_active' => true, 'display_order' => 99,
            ]);
        }, ['field' => ['id' => $id, 'field_label' => 'Special Duty']]);
        $this->assertSame($count + 1, $this->entryCount());
        $entry = $this->latest();
        $this->assertSame('Payroll field Created', $entry->action_label);
        $byItem = array_column($this->rows($entry), null, 'item');
        $this->assertSame('special_duty_t', $byItem['Field key']['new']);
        $this->assertSame('Special Duty', $byItem['Field label']['new']);
        $this->assertSame('earnings', $byItem['Group (earning / deduction / info)']['new']);
        $this->assertSame('Yes', $byItem['Include in total earnings']['new']);
        $this->assertSame('No', $byItem['Include in total deductions']['new'], 'flags that are off are shown too');

        // Rename, move group, change the include flag and order: old -> new for each property.
        $this->audited($admin, 'PUT', "api/v1/settings/payroll-fields/{$id}", ['field_label' => 'Special Duty Pay'], fn () => DB::table('cirt_payroll_field_definitions')->where('id', $id)
            ->update(['field_label' => 'Special Duty Pay', 'field_group' => 'deductions', 'include_in_total_earnings' => false, 'include_in_total_deductions' => true, 'display_order' => 5]));
        $rows = array_column($this->rows($this->latest()), null, 'item');
        $this->assertSame(['Special Duty', 'Special Duty Pay'], [$rows['Field label']['old'], $rows['Field label']['new']]);
        $this->assertSame(['earnings', 'deductions'], [$rows['Group (earning / deduction / info)']['old'], $rows['Group (earning / deduction / info)']['new']]);
        $this->assertSame(['Yes', 'No'], [$rows['Include in total earnings']['old'], $rows['Include in total earnings']['new']]);
        $this->assertSame(['99', '5'], [$rows['Order']['old'], $rows['Order']['new']]);
        $this->assertCount(5, $rows);
        // Deactivate.
        $this->audited($admin, 'POST', "api/v1/settings/payroll-fields/{$id}/deactivate", [], fn () => DB::table('cirt_payroll_field_definitions')->where('id', $id)->update(['is_active' => false]));
        $this->assertSame('Payroll field Deactivated', $this->latest()->action_label);
        $this->assertSame([['Active', 'Yes', 'No']], array_map(fn ($r) => [$r['item'], $r['old'], $r['new']], $this->rows($this->latest())));
        // No-change edit: nothing.
        $count = $this->entryCount();
        $this->audited($admin, 'PUT', "api/v1/settings/payroll-fields/{$id}", ['field_label' => 'Special Duty Pay'], fn () => null);
        $this->assertSame($count, $this->entryCount());
    }

    public function test_user_role_change_is_logged_without_any_secret(): void
    {
        $admin = $this->admin();
        $target = HrmsUser::query()->where('role', 'employee')->firstOrFail();
        $count = $this->entryCount();
        $this->audited($admin, 'PUT', 'api/v1/users/'.$target->id, ['role' => 'admin', 'password' => 'Sup3rSecret!', 'token' => 'abc123'],
            fn () => DB::table('cirt_users')->where('id', $target->id)->update(['role' => 'admin', 'password_hash' => 'changed-hash-value']));
        $this->assertSame($count + 1, $this->entryCount());
        $entry = $this->latest();
        $this->assertSame('Users', $entry->module);
        $rows = $this->rows($entry);
        $this->assertSame([['Role', 'employee', 'admin']], array_map(fn ($r) => [$r['item'], $r['old'], $r['new']], $rows), 'only the role changed');
        $this->assertNotNull($rows[0]['employee']);
        $this->assertNoSecrets($entry);
    }

    public function test_division_rename_and_delete_refused(): void
    {
        $admin = $this->admin();
        $company = $admin->company_id;
        $id = (string) Str::uuid();
        DB::table('cirt_divisions')->insert(['id' => $id, 'company_id' => $company, 'name' => 'Roads', 'is_active' => true]);
        $this->audited($admin, 'PUT', "api/v1/settings/divisions/{$id}", ['name' => 'Roads and Bridges'], fn () => DB::table('cirt_divisions')->where('id', $id)->update(['name' => 'Roads and Bridges']));
        $this->assertSame([['Division name', 'Roads', 'Roads and Bridges']], array_map(fn ($r) => [$r['item'], $r['old'], $r['new']], $this->rows($this->latest())));
        $this->audited($admin, 'DELETE', "api/v1/settings/divisions/{$id}", [], fn () => null, ['error' => 'Division is used by 3 employees.'], 422);
        $entry = $this->latest();
        $this->assertSame('Division Delete Refused', $entry->action_label);
        $this->assertSame('failed', $entry->outcome);
        $this->assertSame('Division is used by 3 employees.', $this->rows($entry)[0]['new']);
    }

    public function test_master_import_logs_a_summary_with_counts_not_every_row(): void
    {
        $admin = $this->admin();
        $count = $this->entryCount();
        $svc = new ActivityLogService;
        $svc->recordRequest($this->request('POST', 'api/v1/payroll/master/import', [], $admin), new JsonResponse([
            'summary' => ['total_rows' => 40, 'inserted_rows' => 5, 'updated_rows' => 30, 'skipped_rows' => 4, 'failed_rows' => 0, 'valid_rows' => 40],
            'rows' => array_fill(0, 40, ['employee_code' => 'X', 'gross_basic_pay' => 1]),
        ], 200));
        $this->assertSame($count + 1, $this->entryCount());
        $entry = $this->latest();
        $this->assertSame('Payroll Master Bulk Update', $entry->action_label);
        $this->assertSame([['Rows in file', '40'], ['Created', '5'], ['Updated', '30'], ['Skipped', '4'], ['Failed', '0']], array_map(fn ($r) => [$r['item'], $r['new']], $this->rows($entry)));
        $this->assertSame(5, $entry->summary['counts']['inserted_rows']);
    }

    public function test_generate_payroll_logs_period_employees_and_totals(): void
    {
        $admin = $this->admin();
        $period = DB::table('cirt_payroll_periods')->where('company_id', $admin->company_id)->orderByDesc('period_start')->first();
        $period !== null || $this->markTestSkipped('No payroll period in the local database.');
        $count = $this->entryCount();
        $year = (int) substr((string) $period->period_start, 0, 4);
        $month = (int) substr((string) $period->period_start, 5, 2);
        (new ActivityLogService)->recordRequest($this->request('POST', 'api/v1/payroll/run', ['year' => $year, 'month' => $month, 'payrollPeriodId' => $period->id], $admin), new JsonResponse(['ok' => true], 200));
        $this->assertSame($count + 1, $this->entryCount());
        $entry = $this->latest();
        $this->assertSame('Payroll Generated', $entry->action_label);
        $items = array_column($this->rows($entry), 'item');
        $this->assertSame(['Payroll period', 'Employees', 'Total gross', 'Total deductions', 'Total net pay'], $items);
        $this->assertSame(sprintf('%02d/%04d', $month, $year), $entry->summary['period']);
        $this->assertSame($admin->name ?? $admin->email, $entry->performed_by_name, 'who did it');
    }

    public function test_report_download_is_one_record_with_report_and_periods_only(): void
    {
        $admin = $this->admin();
        $count = $this->entryCount();
        (new ActivityLogService)->recordRequest($this->request('GET', 'api/v1/payroll/post-downloads/tds', ['months' => '2026-05,2026-09'], $admin), new JsonResponse([], 200));
        $this->assertSame($count + 1, $this->entryCount());
        $entry = $this->latest();
        $this->assertSame(['Report Downloaded', 'Reports'], [$entry->action_label, $entry->module]);
        $this->assertSame([['Report', 'TDS Data'], ['Period(s)', '2026-05,2026-09']], array_map(fn ($r) => [$r['item'], $r['new']], $this->rows($entry)));
        // A failed download is not logged.
        $count = $this->entryCount();
        (new ActivityLogService)->recordRequest($this->request('GET', 'api/v1/payroll/post-downloads/tds', ['months' => '2026-05'], $admin), new JsonResponse([], 422));
        $this->assertSame($count, $this->entryCount());
    }

    public function test_previews_are_never_activity(): void
    {
        $admin = $this->admin();
        $count = $this->entryCount();
        $svc = new ActivityLogService;
        $req = $this->request('POST', 'api/v1/settings/electricity-tariffs/preview', ['units' => 80], $admin);
        $svc->recordRequest($req, new JsonResponse([], 200), null, null, $svc->captureAuditBefore($req));
        $req = $this->request('POST', 'api/v1/payroll/master/import-preview', [], $admin);
        $svc->recordRequest($req, new JsonResponse([], 200), null, null, $svc->captureAuditBefore($req));
        $this->assertSame($count, $this->entryCount());
    }

    public function test_the_diff_helper_formats_by_type_hides_secrets_and_ignores_unchanged(): void
    {
        $changes = ActivityDiff::diff(
            ['electricity' => 49, 'night_hours' => 0, 'da_arrears' => 1923, 'default_da_percent' => 53, 'password_hash' => 'a', 'updated_at' => 'x', 'note' => 'same', 'is_active' => true, 'effective_from' => '2026-10-01'],
            ['electricity' => 98, 'night_hours' => 120, 'da_arrears' => 2000, 'default_da_percent' => 55, 'password_hash' => 'b', 'updated_at' => 'y', 'note' => 'same', 'is_active' => false, 'effective_from' => '2026-11-01'],
        );
        $shown = array_map(fn ($c) => [$c['label'], ActivityDiff::format($c['old'], $c['type']), ActivityDiff::format($c['new'], $c['type'])], $changes);
        $this->assertSame([
            ['Electricity', '49', '98'], ['Night Hours', '0', '120'], ['Da Arrears', '1,923', '2,000'], ['Default Da Percent', '53%', '55%'],
            ['Is Active', 'Yes', 'No'], ['Effective From', '01/10/2026', '01/11/2026'],
        ], $shown);
        $this->assertSame([], ActivityDiff::diff(['a' => 1.0, 'b' => '2'], ['a' => 1, 'b' => 2]), 'nothing changed');
        $this->assertSame('12,34,567', ActivityDiff::format(1234567, 'money'));
        $this->assertEquals(['x' => 1, 'nested' => []], ActivityDiff::scrub(['x' => 1, 'api_token' => 's', 'nested' => ['password' => 'p']]), 'secrets are scrubbed');
    }

    public function test_list_endpoint_pages_and_filters_by_module_user_date_employee_and_month(): void
    {
        $admin = $this->admin();
        $emp = $this->sampleEmployees(1)['users'][0];
        $svc = new ActivityLogService;
        for ($i = 0; $i < 12; $i++) {
            $svc->recordRequest(
                $this->request('DELETE', 'api/v1/payroll/drafts', ['year' => 2031, 'month' => 3], $admin),
                new JsonResponse([], 200), null, [$emp => ['x' => $i]],
            );
        }
        $controller = new ActivityLogController;
        $page1 = $controller->entries($this->request('GET', 'x', ['per_page' => 10, 'page' => 1, 'year' => 2031, 'month' => 3], $admin))->getData(true);
        $page2 = $controller->entries($this->request('GET', 'x', ['per_page' => 10, 'page' => 2, 'year' => 2031, 'month' => 3], $admin))->getData(true);
        $this->assertCount(10, $page1['entries']);
        $this->assertCount(2, $page2['entries']);
        $this->assertSame(12, $page1['pagination']['total']);
        $this->assertSame(2, $page1['pagination']['lastPage']);
        $this->assertSame(0, $controller->entries($this->request('GET', 'x', ['year' => 2031, 'month' => 4], $admin))->getData(true)['pagination']['total'], 'month filter');
        $this->assertSame(0, $controller->entries($this->request('GET', 'x', ['year' => 2031, 'module' => 'Settings'], $admin))->getData(true)['pagination']['total'], 'module filter');
        $this->assertSame(12, $controller->entries($this->request('GET', 'x', ['year' => 2031, 'module' => 'Payroll', 'actor' => mb_substr((string) ($admin->name ?? $admin->email), 0, 3)], $admin))->getData(true)['pagination']['total'], 'performed-by filter');
        $this->assertContains('Quarters', $page1['modules']);
        // Employee filter finds entries whose details name the employee.
        $svc->recordRequest($this->request('POST', 'api/v1/payroll/drafts', ['year' => 2031, 'month' => 5, 'employees' => [['employeeUserId' => $emp, 'rowPayload' => ['governmentMonthly' => ['deductions' => ['mess' => 30]]]]]], $admin),
            new JsonResponse([], 200), null, [$emp => (new \ReflectionMethod(ActivityLogService::class, 'draftRowValues'))->invoke($svc, ['rowPayload' => ['governmentMonthly' => ['deductions' => ['mess' => 10]]]])]);
        $name = (string) DB::table('cirt_users')->where('id', $emp)->value('name');
        $found = $controller->entries($this->request('GET', 'x', ['employee' => mb_substr($name, 0, 4), 'year' => 2031, 'month' => 5], $admin))->getData(true);
        $this->assertSame(1, $found['pagination']['total'], 'employee filter');
        // Date range: from today onwards finds them, a future-only range finds nothing.
        $this->assertGreaterThan(0, $controller->entries($this->request('GET', 'x', ['from' => date('Y-m-d'), 'to' => date('Y-m-d')], $admin))->getData(true)['pagination']['total']);
        $this->assertSame(0, $controller->entries($this->request('GET', 'x', ['from' => '2099-01-01'], $admin))->getData(true)['pagination']['total']);
    }

    public function test_old_records_without_a_diff_still_display_sensibly(): void
    {
        $admin = $this->admin();
        $entry = HrmsActivityLogEntry::query()->create([
            'company_id' => $admin->company_id, 'action_code' => 'payroll.generated', 'action_label' => 'Payroll Generated', 'module' => 'Payroll',
            'performed_by_name' => 'Admin', 'performed_at' => now()->subYear(), 'employee_count' => 12, 'detail_count' => 0, 'outcome' => 'succeeded',
        ]);
        DB::table('cirt_activity_log_details')->insert(['id' => (string) Str::uuid(), 'entry_id' => $entry->id, 'changed_item' => 'Mess Deduction', 'previous_value' => '25', 'updated_value' => '30', 'sort_order' => 0]);
        $detail = (new ActivityLogController)->entryDetails($this->request('GET', 'x', [], $admin), $entry->id)->getData(true)['entry'];
        $this->assertSame([['employee' => null, 'changedItem' => 'Mess Deduction', 'previousValue' => '25', 'updatedValue' => '30', 'kind' => 'typed', 'diff' => null]], $detail['details'], 'a row without a stored diff is still shown');
        $bare = HrmsActivityLogEntry::query()->create([
            'company_id' => $admin->company_id, 'action_code' => 'payroll.generated', 'action_label' => 'Payroll Generated', 'module' => 'Payroll',
            'performed_by_name' => 'Admin', 'performed_at' => now()->subYears(2), 'employee_count' => 12, 'detail_count' => 0, 'outcome' => 'succeeded',
        ]);
        $d2 = (new ActivityLogController)->entryDetails($this->request('GET', 'x', [], $admin), $bare->id)->getData(true)['entry'];
        $this->assertSame([], $d2['details']);
        $this->assertStringContainsString('before field-level change tracking', (string) $d2['legacyNote']);
    }

    /** Neither the stored rows nor their JSON diffs may ever carry a password, token, secret or hash. */
    private function assertNoSecrets(HrmsActivityLogEntry $entry): void
    {
        $blob = json_encode([$entry->toArray(), DB::table('cirt_activity_log_details')->where('entry_id', $entry->id)->get()->all()]);
        foreach (['Sup3rSecret', 'abc123', 'changed-hash-value', 'password_hash', 'password'] as $needle) {
            $this->assertStringNotContainsStringIgnoringCase($needle, (string) $blob, "no {$needle} in the log");
        }
    }
}
