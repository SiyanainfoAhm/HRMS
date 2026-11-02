<?php

namespace Tests\Database;

use App\Models\HrmsPayrollMaster;
use App\Support\OrgNameSync;

/** Renaming/deleting a division, department or designation must reach Payroll Master. */
final class OrgNameSyncTest extends DatabaseTestCase
{
    public function test_rename_reaches_current_masters_and_usage_blocks_delete(): void
    {
        $master = HrmsPayrollMaster::query()->whereNull('effective_to')->first();
        if (! $master) $this->markTestSkipped('No payroll master in the local database.');
        $company = (string) $master->company_id;
        $master->forceFill(['department' => 'Zz Test Dept', 'division' => 'Zz Test Div', 'designation' => 'Zz Test Desig'])->save();

        $this->assertSame(1, OrgNameSync::masterUsage('department', $company, ' zz test dept '));
        foreach (['department' => 'Zz Renamed Dept', 'division' => 'Zz Renamed Div', 'designation' => 'Zz Renamed Desig'] as $column => $new) {
            $old = $master->fresh()->{$column};
            $this->assertSame(1, OrgNameSync::rename($column, $company, $old, $new), $column);
        }
        $after = $master->fresh();
        $this->assertSame('Zz Renamed Dept', $after->department);
        $this->assertSame('Zz Renamed Div', $after->division);
        $this->assertSame('Zz Renamed Desig', $after->designation);
        $this->assertSame(0, OrgNameSync::masterUsage('department', $company, 'Zz Test Dept'), 'old name no longer used');
        $this->assertSame(0, OrgNameSync::rename('salary', $company, 'a', 'b'), 'only the three org columns are accepted');
    }
}
