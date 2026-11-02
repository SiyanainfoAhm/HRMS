<?php

namespace Tests\Database;

use App\Models\HrmsElectricityTariff;
use App\Services\ElectricityTariffService;

/** Settings saves that omit a field must leave that field alone. */
final class SettingsPartialUpdateTest extends DatabaseTestCase
{
    private function slabs(): array
    {
        return [
            ['fromUnit' => 0, 'toUnit' => 100, 'ratePerUnit' => 3.96, 'fuelChargePerUnit' => 0.35],
            ['fromUnit' => 101, 'toUnit' => null, 'ratePerUnit' => 10.8, 'fuelChargePerUnit' => 0.65],
        ];
    }

    public function test_editing_only_slabs_keeps_charges_and_inactive_flag(): void
    {
        ['company' => $company] = $this->sampleEmployees(1);
        $svc = app(ElectricityTariffService::class);
        $created = $svc->create($company, [
            'effectiveFrom' => '2099-01-01', 'sthirAakar' => 130, 'vahanAakarPerUnit' => 1.6, 'fuelCharge' => 2, 'dutyPercentage' => 16,
            'isActive' => false, 'slabs' => $this->slabs(),
        ]);
        $tariff = HrmsElectricityTariff::findOrFail($created['id']);

        $slabs = $this->slabs();
        $slabs[0]['ratePerUnit'] = 4.5;
        $updated = $svc->update($tariff, ['slabs' => $slabs]);

        $this->assertSame(130.0, $updated['sthirAakar'], 'Sthir Aakar not zeroed by a slabs-only edit');
        $this->assertSame(1.6, $updated['vahanAakarPerUnit']);
        $this->assertSame(16.0, $updated['dutyPercentage']);
        $this->assertSame(2.0, $updated['fuelCharge']);
        $this->assertFalse($updated['isActive'], 'a deactivated tariff is not re-activated by an unrelated edit');
        $this->assertSame(4.5, $updated['slabs'][0]['ratePerUnit'], 'the slab edit itself is saved');

        $zeroed = $svc->update($tariff->fresh(), ['dutyPercentage' => 0]);
        $this->assertSame(0.0, $zeroed['dutyPercentage'], 'an explicit 0 is still a value');
        $this->assertSame(130.0, $zeroed['sthirAakar']);
    }

    public function test_cpf_settings_reject_a_basis_payroll_would_reject_and_keep_unsent_values(): void
    {
        ['company' => $company] = $this->sampleEmployees(1);
        $fields = app(\App\Services\PayrollFieldService::class);
        $before = $fields->saveCalculationSettings($company, []);

        $this->expectException(\Illuminate\Validation\ValidationException::class);
        try {
            $fields->saveCalculationSettings($company, ['cpf_basis_field_keys' => ['gross_basic', 'does_not_exist']]);
        } finally {
            $after = $fields->saveCalculationSettings($company, ['cpf_percentage' => $before['cpfPercentage'] ?? 12]);
            $this->assertEquals($before['cpfBasisFieldKeys'] ?? null, $after['cpfBasisFieldKeys'] ?? null, 'basis keys unchanged by the rejected save and by a percentage-only save');
        }
    }
}
