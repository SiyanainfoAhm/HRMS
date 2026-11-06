<?php

namespace Tests\Database;

use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * payroll:remove-orphan-quarter and payroll:set-quarter-rents, on the synthetic TestWorld (rolled back after each test).
 */
final class QuarterCleanupCommandsTest extends DatabaseTestCase
{
    private function dummyQuarter(string $name = 'Q-DUMMY'): string
    {
        $id = (string) Str::uuid();
        DB::table('cirt_quarters')->insert([
            'id' => $id, 'company_id' => $this->world->company, 'quarter_name' => $name, 'quarter_type' => 'Type I', 'monthly_rent' => 20000,
            'status' => 'inactive', 'created_at' => now(), 'updated_at' => now(),
        ]);

        return $id;
    }

    private function assignment(string $quarterId, string $employeeId, ?string $to): void
    {
        DB::table('cirt_quarter_assignments')->insert([
            'id' => (string) Str::uuid(), 'company_id' => $this->world->company, 'quarter_id' => $quarterId, 'employee_id' => $employeeId,
            'assigned_from' => '2026-07-01', 'assigned_to' => $to, 'rent_at_assignment' => 20000, 'created_at' => now(), 'updated_at' => now(),
        ]);
    }

    public function test_orphan_quarter_dry_run_changes_nothing_and_apply_deletes_quarter_and_orphan_assignment(): void
    {
        $q = $this->dummyQuarter();
        $this->assignment($q, (string) Str::uuid(), '2026-10-30'); // employee id that does not exist

        $this->assertSame(0, Artisan::call('payroll:remove-orphan-quarter', ['name' => 'Q-DUMMY']));
        $this->assertSame(1, DB::table('cirt_quarters')->where('id', $q)->count(), 'dry run keeps the quarter');
        $this->assertSame(1, DB::table('cirt_quarter_assignments')->where('quarter_id', $q)->count(), 'dry run keeps the assignment');

        $this->assertSame(0, Artisan::call('payroll:remove-orphan-quarter', ['name' => 'Q-DUMMY', '--apply' => true]));
        $this->assertSame(0, DB::table('cirt_quarters')->where('id', $q)->count());
        $this->assertSame(0, DB::table('cirt_quarter_assignments')->where('quarter_id', $q)->count());
    }

    public function test_orphan_quarter_is_refused_when_an_assignment_is_open_or_belongs_to_a_real_employee(): void
    {
        $open = $this->dummyQuarter('Q-OPEN');
        $this->assignment($open, (string) Str::uuid(), null);
        $this->assertSame(1, Artisan::call('payroll:remove-orphan-quarter', ['name' => 'Q-OPEN', '--apply' => true]));
        $this->assertSame(1, DB::table('cirt_quarters')->where('id', $open)->count(), 'open assignment: refused, nothing deleted');

        $real = $this->dummyQuarter('Q-REAL');
        $this->assignment($real, $this->world->employees[1]['id'], '2026-10-30');
        $this->assertSame(1, Artisan::call('payroll:remove-orphan-quarter', ['name' => 'Q-REAL', '--apply' => true]));
        $this->assertSame(1, DB::table('cirt_quarter_assignments')->where('quarter_id', $real)->count(), 'existing employee: refused');

        $active = $this->world->quarters[1]; // occupied by employee 0
        $name = (string) DB::table('cirt_quarters')->where('id', $active)->value('quarter_name');
        $this->assertSame(1, Artisan::call('payroll:remove-orphan-quarter', ['name' => $name, '--apply' => true]));
        $this->assertSame(1, DB::table('cirt_quarters')->where('id', $active)->count(), 'an active quarter is never deleted');
    }

    public function test_set_quarter_rents_sets_rent_syncs_open_assignments_and_masters_and_verifies_the_total(): void
    {
        $names = DB::table('cirt_quarters')->whereIn('id', $this->world->quarters)->orderBy('quarter_name')->pluck('quarter_name', 'id');
        $rents = [];
        foreach ($names as $name) $rents[$name] = 700.0; // every test quarter to 700
        $file = sys_get_temp_dir().DIRECTORY_SEPARATOR.'quarter_rents_test_'.bin2hex(random_bytes(3)).'.json';
        $openId = $this->world->quarters[1];
        // Only the TestWorld quarters may be active for this check: others in the test database would be "not in the file".
        $others = DB::table('cirt_quarters')->whereNotIn('id', $this->world->quarters)->where('status', '<>', 'inactive')->count();
        if ($others > 0) {
            DB::table('cirt_quarters')->whereNotIn('id', $this->world->quarters)->update(['status' => 'inactive']);
        }
        file_put_contents($file, json_encode(['expect' => ['openAssignments' => 1, 'rentTotal' => 700], 'rents' => $rents]));

        $this->assertSame(0, Artisan::call('payroll:set-quarter-rents', ['--file' => $file]));
        $this->assertEquals(500, DB::table('cirt_quarters')->where('id', $openId)->value('monthly_rent'), 'dry run changes nothing');

        $this->assertSame(0, Artisan::call('payroll:set-quarter-rents', ['--file' => $file, '--apply' => true]));
        foreach ($this->world->quarters as $id) $this->assertEquals(700, DB::table('cirt_quarters')->where('id', $id)->value('monthly_rent'));
        $this->assertEquals(700, DB::table('cirt_quarter_assignments')->where('quarter_id', $openId)->whereNull('assigned_to')->value('rent_at_assignment'), 'open assignment rent synced');

        // A wrong expectation makes it refuse to save.
        file_put_contents($file, json_encode(['expect' => ['openAssignments' => 5, 'rentTotal' => 700], 'rents' => $rents]));
        DB::table('cirt_quarters')->where('id', $openId)->update(['monthly_rent' => 500]);
        $this->assertSame(1, Artisan::call('payroll:set-quarter-rents', ['--file' => $file, '--apply' => true]));
        $this->assertEquals(500, DB::table('cirt_quarters')->where('id', $openId)->value('monthly_rent'), 'mismatch: rolled back');

        // A quarter name that does not exist, or an active quarter missing from the file, is refused.
        file_put_contents($file, json_encode(['rents' => ['NO-SUCH-QUARTER' => 1]]));
        $this->assertSame(1, Artisan::call('payroll:set-quarter-rents', ['--file' => $file, '--apply' => true]));
        @unlink($file);
    }
}
