<?php

namespace Tests\Database;

use App\Models\HrmsPayrollMaster;
use App\Models\HrmsUser;
use App\Services\PayrollMasterService;
use Illuminate\Http\UploadedFile;

/**
 * Re-importing a sheet over existing employees must update only what the sheet
 * carries: no login-password reset, role demotion, status/PT reset, or crash.
 */
final class MasterImportTest extends DatabaseTestCase
{
    private function csv(array $headers, array $rows): UploadedFile
    {
        $path = tempnam(sys_get_temp_dir(), 'imp').'.csv';
        $h = fopen($path, 'w');
        fputcsv($h, $headers);
        foreach ($rows as $row) fputcsv($h, $row);
        fclose($h);

        return new UploadedFile($path, 'master.csv', 'text/csv', null, true);
    }

    /** @return list<string> keys of columns the template requires */
    private function requiredKeys(PayrollMasterService $svc): array
    {
        $m = new \ReflectionMethod($svc, 'importTemplateColumns');
        $keys = [];
        foreach ($m->invoke($svc) as $col) if ($col['required_in_template']) $keys[] = $col['key'];

        return $keys;
    }

    private function valueFor(string $key, HrmsPayrollMaster $m): string
    {
        return match ($key) {
            'date_of_joining', 'date_of_birth' => (string) ($m->{$key}?->toDateString() ?? '2015-01-01'),
            'gross_basic_pay' => (string) (float) $m->gross_basic_pay,
            default => (string) ($m->{$key} ?? ''),
        };
    }

    public function test_reimport_updates_in_place_without_resetting_login_role_status_or_pt(): void
    {
        $svc = app(PayrollMasterService::class);
        $master = HrmsPayrollMaster::query()->whereNull('effective_to')->where('status', 'active')
            ->whereNotNull('employee_user_id')->whereNotNull('email')->whereNotNull('designation')->where('designation', '<>', '')->where('designation', '<>', 'Pending')->first();
        if (! $master) $this->markTestSkipped('No payroll master in the local database.');
        $user = HrmsUser::findOrFail($master->employee_user_id);
        $beforeHash = $user->password_hash;
        $beforeRole = $user->role;
        $beforePt = (float) ($master->professional_tax ?? $master->pt);

        $keys = $this->requiredKeys($svc);
        $row = array_map(fn (string $k) => $k === 'water' ? '123' : $this->valueFor($k, $master), $keys);
        foreach (['water' => '123', 'designation' => $master->designation, 'email' => $master->email] as $extraKey => $extraValue) {
            if (! in_array($extraKey, $keys, true)) { $keys[] = $extraKey; $row[] = $extraValue; }
        }
        $file = $this->csv($keys, [$row]);

        $result = $svc->importFile($file, (string) $master->company_id, (string) $master->created_by);
        $this->assertSame('Import completed successfully', $result['message'], json_encode($result['errors']));
        $this->assertSame(1, $result['summary']['updated_rows']);
        $this->assertSame(0, $result['generated_password_count'], 'no temporary password for an existing login');

        $user->refresh();
        $master->refresh();
        $this->assertSame($beforeHash, $user->password_hash, 'login password untouched by re-import');
        $this->assertEquals($beforeRole, $user->role, 'role not demoted by re-import');
        $this->assertSame('active', $master->status);
        $this->assertEquals($beforePt, (float) ($master->professional_tax ?? $master->pt), 'PT not reset to 200');
        $this->assertEquals(123.0, (float) $master->water, 'the imported value is saved');
    }

    public function test_same_name_and_level_is_not_treated_as_the_same_employee(): void
    {
        $svc = app(PayrollMasterService::class);
        $master = HrmsPayrollMaster::query()->whereNull('effective_to')->where('status', 'active')->first();
        if (! $master) $this->markTestSkipped('No payroll master in the local database.');
        $find = new \ReflectionMethod($svc, 'findExistingMaster');
        $found = $find->invoke($svc, (string) $master->company_id, [
            'employee_code' => 'NO-SUCH-CODE-'.uniqid(), 'name' => $master->name, 'pay_level' => $master->pay_level,
        ]);
        $this->assertNull($found);
    }

    public function test_preview_lists_will_update_will_create_and_ambiguous(): void
    {
        $svc = app(PayrollMasterService::class);
        $masters = HrmsPayrollMaster::query()->whereNull('effective_to')->where('status', 'active')
            ->whereNotNull('email')->where('email', '<>', '')->whereNotNull('employee_code')->orderBy('employee_code')->limit(2)->get();
        if ($masters->count() < 2) $this->markTestSkipped('Need two payroll masters.');
        [$a, $b] = [$masters[0], $masters[1]];
        $company = (string) $a->company_id;

        $keys = $this->requiredKeys($svc);
        foreach (['employee_code', 'email', 'name', 'pay_level'] as $k) if (! in_array($k, $keys, true)) $keys[] = $k;
        $row = function (array $over) use ($keys, $a) {
            return array_map(fn (string $k) => $over[$k] ?? $this->valueFor($k, $a), $keys);
        };
        $file = $this->csv($keys, [
            // 1: same CODE as A, different name  -> update A (matched by code, not name)
            $row(['employee_code' => $a->employee_code, 'email' => 'someone.else@example.com', 'name' => 'Totally Different Name']),
            // 2: A's name + level but no stable key matches -> create, never an update of A
            $row(['employee_code' => 'NEW-'.uniqid(), 'email' => 'brand.new.'.uniqid().'@example.com', 'name' => $a->name]),
            // 3: A's code with B's email -> ambiguous
            $row(['employee_code' => $a->employee_code, 'email' => $b->email, 'name' => 'Mixed Keys']),
        ]);

        $preview = $svc->previewImportFile($file, $company);
        $actions = array_column($preview['rows'], 'action');
        $this->assertSame(['update', 'insert', 'ambiguous'], $actions);
        $this->assertSame(['Will update', 'Will create', 'Ambiguous (skipped)'], array_column($preview['rows'], 'actionLabel'));
        $this->assertSame(['employee_code'], $preview['rows'][0]['matchedBy']);
        $this->assertSame(1, $preview['summary']['update_rows'] ?? null);
        $this->assertSame(1, $preview['summary']['ambiguous_rows'] ?? null);
        $this->assertSame([], $preview['rows'][2]['errors'], 'ambiguous rows are skipped, not errors');

        $find = new \ReflectionMethod($svc, 'matchExistingMasters');
        $this->assertSame([], $find->invoke($svc, $company, ['name' => $a->name, 'pay_level' => $a->pay_level])['masters'], 'never by name');
        $order = $find->invoke($svc, $company, ['user_id' => $a->employee_user_id, 'employee_code' => $a->employee_code, 'email' => $a->email]);
        $this->assertSame([(string) $a->id], array_keys($order['masters']));
        $this->assertSame(['user_id', 'employee_code', 'email'], $order['via'][(string) $a->id], 'keys tried in the fixed order');
    }
}
