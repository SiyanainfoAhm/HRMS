<?php

namespace Tests\Database;

use App\Models\HrmsQuarter;
use App\Services\QuarterService;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * Hard-delete is allowed only for INACTIVE quarters that were never assigned;
 * inactive quarters stay out of the default list and out of rent totals.
 */
final class QuarterDeleteTest extends DatabaseTestCase
{
    private function service(): QuarterService
    {
        return app(QuarterService::class);
    }

    /** @return array{0: string, 1: string, 2: string} company, employee (no assignments), quarter type id */
    private function context(): array
    {
        ['company' => $company, 'users' => $users] = $this->sampleEmployees(25);
        $employee = null;
        foreach ($users as $uid) {
            if (! DB::table('cirt_quarter_assignments')->where('employee_id', $uid)->exists()) { $employee = $uid; break; }
        }
        $typeId = DB::table('cirt_quarter_types')->where('company_id', $company)->where('is_active', true)->value('id');
        if ($employee === null || $typeId === null) {
            $this->markTestSkipped('Local database has no unassigned employee / quarter type to test with.');
        }

        return [$company, $employee, (string) $typeId];
    }

    private function newQuarter(string $company, string $typeId, string $name): HrmsQuarter
    {
        $created = $this->service()->create($company, (string) DB::table('cirt_payroll_master')->value('user_id'), [
            'quarter_name' => $name, 'quarter_type_id' => $typeId, 'monthly_rent' => 500,
        ]);

        return HrmsQuarter::findOrFail($created['id']);
    }

    public function test_inactive_never_assigned_quarter_can_be_deleted(): void
    {
        [$company, , $typeId] = $this->context();
        $quarter = $this->newQuarter($company, $typeId, 'ZZ-DEL-TEST-1');

        $this->service()->deactivate($quarter, $company);
        $listed = collect($this->service()->listForCompany($company, false, true))->firstWhere('id', $quarter->id);
        $this->assertTrue($listed['canDelete']);

        $this->service()->delete($quarter->fresh(), $company);
        $this->assertNull(HrmsQuarter::find($quarter->id));
    }

    public function test_active_quarter_cannot_be_deleted(): void
    {
        [$company, , $typeId] = $this->context();
        $quarter = $this->newQuarter($company, $typeId, 'ZZ-DEL-TEST-2');

        $this->expectException(ValidationException::class);
        try {
            $this->service()->delete($quarter, $company);
        } finally {
            $this->assertNotNull(HrmsQuarter::find($quarter->id));
        }
    }

    public function test_quarter_with_assignment_history_cannot_be_deleted_even_after_unassign(): void
    {
        [$company, $employee, $typeId] = $this->context();
        $quarter = $this->newQuarter($company, $typeId, 'ZZ-DEL-TEST-3');

        $this->service()->assign($quarter, $company, $employee, $employee);
        $this->service()->unassign($quarter->fresh(), $company, $employee);
        $this->service()->deactivate($quarter->fresh(), $company);

        $listed = collect($this->service()->listForCompany($company, false, true))->firstWhere('id', $quarter->id);
        $this->assertFalse($listed['canDelete'], 'UI must not offer Delete');

        try {
            $this->service()->delete($quarter->fresh(), $company);
            $this->fail('API must refuse to delete a quarter with assignment history.');
        } catch (ValidationException $e) {
            $this->assertStringContainsString('assignment history', $e->errors()['quarter'][0]);
        }
        $this->assertNotNull(HrmsQuarter::find($quarter->id));
    }

    public function test_inactive_quarters_are_hidden_by_default_and_not_in_rent_totals(): void
    {
        [$company, , $typeId] = $this->context();
        $quarter = $this->newQuarter($company, $typeId, 'ZZ-DEL-TEST-4');
        $this->service()->deactivate($quarter, $company);

        $default = collect($this->service()->listForCompany($company));
        $this->assertNull($default->firstWhere('id', $quarter->id));
        $this->assertNotNull(collect($this->service()->listForCompany($company, false, true))->firstWhere('id', $quarter->id));

        // No inactive quarter may hold an open assignment (it would deduct rent).
        $this->assertSame(0, DB::table('cirt_quarter_assignments as a')
            ->join('cirt_quarters as q', 'q.id', '=', 'a.quarter_id')
            ->where('q.company_id', $company)->where('q.status', 'inactive')->whereNull('a.assigned_to')->count());
    }
}
