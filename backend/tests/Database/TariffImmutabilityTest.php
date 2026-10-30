<?php

namespace Tests\Database;

use App\Models\HrmsElectricityTariff;
use App\Services\ElectricityTariffService;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

/** A tariff in force is history: change it by adding a new effective date, never in place. */
final class TariffImmutabilityTest extends DatabaseTestCase
{
    private function slabs(): array
    {
        return [['fromUnit' => 0, 'toUnit' => null, 'ratePerUnit' => 4.0, 'fuelChargePerUnit' => 0.0]];
    }

    private function inForce(string $company): HrmsElectricityTariff
    {
        $id = (string) Str::uuid();
        DB::table('cirt_electricity_tariffs')->insert([
            'id' => $id, 'company_id' => $company, 'effective_from' => '2000-01-01', 'sthir_aakar' => 100, 'vahan_aakar_per_unit' => 1,
            'fuel_charge' => 0, 'duty_percentage' => 10, 'is_active' => true, 'created_at' => now(), 'updated_at' => now(),
        ]);

        return HrmsElectricityTariff::findOrFail($id);
    }

    public function test_a_tariff_in_force_cannot_be_edited_or_deactivated(): void
    {
        ['company' => $company] = $this->sampleEmployees(1);
        $svc = app(ElectricityTariffService::class);
        $tariff = $this->inForce($company);

        foreach ([fn () => $svc->update($tariff, ['sthirAakar' => 999]), fn () => $svc->update($tariff, ['slabs' => $this->slabs()]), fn () => $svc->deactivate($tariff)] as $attempt) {
            try {
                $attempt();
                $this->fail('editing a tariff in force must be refused');
            } catch (ValidationException $e) {
                $this->assertStringContainsString('new tariff with a new effective date', $e->errors()['tariff'][0]);
            }
        }
        $this->assertEquals(100.0, (float) $tariff->fresh()->sthir_aakar, 'unchanged');
        $this->assertTrue((bool) $tariff->fresh()->is_active);
    }

    public function test_new_tariff_must_start_after_every_drafted_or_generated_month(): void
    {
        ['company' => $company] = $this->sampleEmployees(1);
        $svc = app(ElectricityTariffService::class);
        $lastPeriod = DB::table('cirt_payroll_periods')->where('company_id', $company)->orderByDesc('period_start')->value('period_start');
        if (! $lastPeriod) $this->markTestSkipped('No payroll period in the local database.');
        $lockedEnd = \Illuminate\Support\Carbon::parse($lastPeriod)->endOfMonth()->toDateString();

        $this->expectException(ValidationException::class);
        $svc->create($company, ['effectiveFrom' => $lockedEnd, 'sthirAakar' => 1, 'slabs' => $this->slabs()]);
    }

    public function test_adding_a_future_tariff_leaves_billing_of_existing_months_unchanged(): void
    {
        ['company' => $company] = $this->sampleEmployees(1);
        $svc = app(ElectricityTariffService::class);
        $month = '2026-10-31';
        $before = $svc->resolveForDate($company, $month)?->id;

        $created = $svc->create($company, ['effectiveFrom' => '2099-04-01', 'sthirAakar' => 500, 'vahanAakarPerUnit' => 9, 'dutyPercentage' => 50, 'slabs' => $this->slabs()]);
        $this->assertSame('2099-04-01', $created['effectiveFrom']);
        $this->assertSame($before, $svc->resolveForDate($company, $month)?->id, 'an existing month still resolves to the same tariff');
        $this->assertSame($created['id'], $svc->resolveForDate($company, '2099-04-30')?->id, 'the new tariff applies from its date');

        // Until it takes effect, a future tariff may still be corrected.
        $fixed = $svc->update(HrmsElectricityTariff::findOrFail($created['id']), ['sthirAakar' => 450]);
        $this->assertSame(450.0, $fixed['sthirAakar']);
    }
}
