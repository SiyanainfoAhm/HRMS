<?php

namespace Tests\Database;

use App\Services\PostPayrollDownloadService;
use App\Support\OrgNameSnapshot;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Division / designation saved with each payroll row. The migration runs INSIDE the test transaction (rolled back), so the
 * local database is left exactly as it was.
 */
final class OrgNameSnapshotTest extends DatabaseTestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        DB::table('cirt_monthly_payroll')->exists() || $this->markTestSkipped('No generated payroll in this database.');
        $migration = require dirname(__DIR__, 2).'/database/migrations/2026_11_04_100000_add_org_name_snapshot_to_monthly_payroll.php';
        $migration->up();
        OrgNameSnapshot::forget();
    }

    protected function tearDown(): void
    {
        OrgNameSnapshot::forget();
        parent::tearDown();
    }

    public function test_migration_adds_nullable_columns_and_freezes_existing_rows_from_their_master_without_touching_amounts(): void
    {
        $this->assertTrue(Schema::hasColumn('cirt_monthly_payroll', 'division_name'));
        $this->assertTrue(Schema::hasColumn('cirt_monthly_payroll', 'designation_name'));
        $row = DB::table('cirt_monthly_payroll as m')->join('cirt_payroll_master as pm', 'pm.id', '=', 'm.payroll_master_id')
            ->whereNotNull('pm.division')->whereRaw("BTRIM(pm.division) <> ''")->first(['m.id', 'm.division_name', 'pm.division', 'm.total_earnings']);
        $this->assertNotNull($row);
        $this->assertSame(trim($row->division), $row->division_name, 'backfilled from the master the row was generated against');
    }

    public function test_new_rows_get_the_master_division_and_designation(): void
    {
        $master = DB::table('cirt_payroll_master')->whereNotNull('division')->whereRaw("BTRIM(division) <> ''")->first(['id', 'division', 'designation']);
        $snap = OrgNameSnapshot::forMaster((string) $master->id);
        $this->assertSame(trim($master->division), $snap['division_name']);
        $this->assertSame(trim((string) $master->designation) ?: null, $snap['designation_name']);
        $this->assertSame([], OrgNameSnapshot::forMaster(null));
    }

    public function test_the_report_shows_the_saved_name_even_after_the_master_is_renamed(): void
    {
        $svc = new PostPayrollDownloadService;
        $company = (string) DB::table('cirt_monthly_payroll')->value('company_id');
        $before = $svc->rows($company, 202609, 202609);
        $victim = $before[0];
        $masterId = (string) $victim['payroll_master_id'];
        $saved = trim((string) $victim['division_name']);

        // Settings rename: the master's division text changes (OrgNameSync does this for the current master).
        DB::table('cirt_payroll_master')->where('id', $masterId)->update(['division' => 'Renamed After The Fact']);
        $after = $svc->rows($company, 202609, 202609);
        $table = $svc->divisionWiseTable($after, $svc->settingsDivisionNames($company));

        $names = array_keys($table['divisions']);
        $this->assertContains($saved !== '' ? $saved : PostPayrollDownloadService::UNASSIGNED, $names, 'the month keeps the name it was generated with');
        $this->assertNotContains('Renamed After The Fact', $names, 'a later rename does not rewrite the old month');
        $this->assertSame(count($before), array_sum(array_column($table['divisions'], 'rows')));

        // A row generated without a saved name falls back to the (renamed) master division.
        DB::table('cirt_monthly_payroll')->where('id', $victim['id'])->update(['division_name' => null]);
        $table = $svc->divisionWiseTable($svc->rows($company, 202609, 202609), []);
        $this->assertContains('Renamed After The Fact', array_keys($table['divisions']));
    }

    public function test_real_september_divisions_reconcile_with_the_database_totals(): void
    {
        $svc = new PostPayrollDownloadService;
        $company = (string) DB::table('cirt_monthly_payroll')->value('company_id');
        $rows = $svc->rows($company, 202609, 202609);
        $t = $svc->divisionWiseTable($rows, $svc->settingsDivisionNames($company));
        $db = DB::table('cirt_monthly_payroll')->where('company_id', $company)->whereDate('month_year', '2026-09-01')
            ->selectRaw('count(*) c, sum(round(total_earnings)) g, sum(round(total_deductions)) d, sum(round(net_salary)) n')->first();
        $this->assertSame((int) $db->c, array_sum(array_column($t['divisions'], 'rows')), 'headcount');
        $this->assertSame((float) $db->g, $t['totals'][8], 'gross');
        $this->assertSame((float) $db->d, $t['totals'][9], 'deductions');
        $this->assertSame((float) $db->n, $t['totals'][10], 'net');
        $collapse = fn (string $n) => trim((string) preg_replace('/\s+/u', ' ', $n)); // inner double spaces are tidied in the report
        $real = array_map($collapse, array_merge($svc->settingsDivisionNames($company), array_map(fn ($r) => (string) ($r['_master']['division'] ?? ''), $rows)));
        $this->assertSame([], array_diff(array_keys($t['divisions']), $real, [PostPayrollDownloadService::UNASSIGNED]), 'only real division names');
    }
}
