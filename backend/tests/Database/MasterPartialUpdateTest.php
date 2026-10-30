<?php

namespace Tests\Database;

use App\Models\HrmsPayrollMaster;
use App\Services\PayrollMasterService;
use Illuminate\Support\Facades\DB;

/**
 * A Payroll Master save that omits a field must keep the stored value. Before the
 * fix, mergeCalculated() replaced every omitted field with a default
 * ('Pending', manual_fixed, active, 0, null), so partial saves wiped data.
 */
final class MasterPartialUpdateTest extends DatabaseTestCase
{
    private const KEEP = [
        'email', 'phone', 'designation', 'department', 'division', 'electricity_mode', 'electricity_applicable', 'status',
        'bank_name', 'bank_account_number', 'bank_ifsc', 'pan', 'aadhaar', 'uan', 'cpf_no', 'increment_month',
        'has_quarter', 'quarter_id', 'cpf_use_company_settings', 'remarks',
    ];

    private function master(): HrmsPayrollMaster
    {
        $m = HrmsPayrollMaster::query()->whereNull('effective_to')->where('status', 'active')
            ->whereNotNull('quarter_id')->whereNotNull('email')->first()
            ?? HrmsPayrollMaster::query()->whereNull('effective_to')->where('status', 'active')->whereNotNull('email')->first();
        if (! $m) $this->markTestSkipped('No payroll master in the local database.');

        return $m;
    }

    public function test_thin_payload_does_not_reset_stored_fields(): void
    {
        $master = $this->master();
        $before = $master->fresh()->only([...self::KEEP, 'mess', 'creditSociety', 'credit_society', 'effective_from']);
        $mess = (float) $master->mess;
        $service = app(PayrollMasterService::class);

        $payload = [
            'name' => $master->name,
            'pay_level' => $master->pay_level,
            'gross_basic_pay' => (float) $master->gross_basic_pay,
            'water' => 400, // the only field this save is about
            'quarter_id' => $master->quarter_id,
            'has_quarter' => (bool) $master->has_quarter,
        ];
        $after = $service->createOrUpdatePayrollMasterRevision(
            $payload, (string) $master->company_id, (string) $master->created_by, $master, false, false, false, null, false,
        )->fresh();

        foreach (self::KEEP as $field) {
            $this->assertEquals($before[$field], $after->{$field}, "{$field} must survive a save that did not send it");
        }
        $this->assertEquals($mess, (float) $after->mess, 'mess deduction not reset to 0');
        $this->assertEquals(400.0, (float) $after->water, 'the field that was sent is saved');
        $this->assertEquals(
            optional($before['effective_from'])->toDateString(),
            optional($after->effective_from)->toDateString(),
            'effective date not reset to today',
        );
    }

    public function test_edited_alias_beats_backfilled_canonical_value(): void
    {
        $master = $this->master();
        $service = app(PayrollMasterService::class);
        $after = $service->createOrUpdatePayrollMasterRevision(
            ['name' => $master->name, 'payLevel' => $master->pay_level, 'grossBasicPay' => (float) $master->gross_basic_pay, 'medicalFixed' => 777],
            (string) $master->company_id, (string) $master->created_by, $master, false, false, false, null, false,
        )->fresh();
        $this->assertEquals(777.0, (float) ($after->medical_fixed ?? $after->medical));
    }

    public function test_revision_inherits_electricity_quarter_and_cpf_settings(): void
    {
        $master = $this->master();
        $master->forceFill(['electricity_mode' => 'unit_based', 'electricity_applicable' => false, 'quarter_rent' => 321.5])->save();
        $service = app(PayrollMasterService::class);

        $new = $service->reviseMasterRecord(
            $master->fresh(),
            ['gross_basic_pay' => (float) $master->gross_basic_pay + 1000, 'effective_from' => now()->addYear()->toDateString()],
            (string) $master->company_id,
            (string) $master->created_by,
            'test increment',
        )->fresh();

        $this->assertNotSame($master->id, $new->id);
        $this->assertSame('unit_based', $new->electricity_mode, 'electricity mode inherited');
        $this->assertFalse((bool) $new->electricity_applicable, 'electricity applicability inherited');
        $this->assertSame($master->quarter_id, $new->quarter_id, 'quarter inherited');
        $this->assertEquals((bool) $master->has_quarter, (bool) $new->has_quarter);
        $this->assertEquals(321.5, (float) $new->quarter_rent, 'quarter rent inherited');
        $this->assertSame($master->cpf_use_company_settings, $new->cpf_use_company_settings);
        $this->assertEquals((float) $master->gross_basic_pay + 1000, (float) $new->gross_basic_pay, 'the revised value is applied');
    }

    public function test_institute_da_hra_revision_keeps_electricity_quarter_and_cpf_settings(): void
    {
        $master = $this->master();
        $master->forceFill(['electricity_mode' => 'unit_based', 'electricity_applicable' => false])->save();
        $before = $master->fresh();
        $newDa = (float) $before->da_percent + 1;

        $summary = app(PayrollMasterService::class)->applyInstituteDaHraRevisionToPayrollMasters(
            (string) $master->company_id, $newDa, (float) $before->hra_percent, now()->toDateString(), 'test revision', (string) $master->created_by,
        );
        $this->assertSame([], $summary['errors']);
        $after = HrmsPayrollMaster::query()->findOrFail($master->id);
        $this->assertEquals($newDa, (float) $after->da_percent, 'the revision itself is applied');
        $this->assertSame('unit_based', $after->electricity_mode);
        $this->assertFalse((bool) $after->electricity_applicable);
        $this->assertSame($before->quarter_id, $after->quarter_id);
        $this->assertEquals((float) $before->quarter_rent, (float) $after->quarter_rent);
    }
}
