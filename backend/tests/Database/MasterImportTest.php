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
}
