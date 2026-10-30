<?php

namespace Tests\Unit;

use App\Services\PayrollCalculationService;
use App\Services\PayrollDraftService;
use App\Services\QuarterService;
use App\Services\QuarterTypeService;
use PHPUnit\Framework\TestCase;

/**
 * Loading or saving a draft must not replace stored values that the quarter
 * assignment does not own (leave-adjusted HRA, typed HRA, typed rent).
 */
final class DraftQuarterReconcileTest extends TestCase
{
    private function service(): PayrollDraftService
    {
        return new PayrollDraftService(new QuarterService(new QuarterTypeService), new PayrollCalculationService);
    }

    private function payload(array $gm = [], array $gr = []): array
    {
        return [
            'payDays' => 30,
            'governmentMonthly' => array_merge([
                'basicPaid' => 50000, 'hraActual' => 15000, 'hraPaid' => 11111,
                'totalEarnings' => 61111, 'deductions' => ['pt' => 200, 'quarterRent' => 0],
            ], $gm),
            'govRecalc' => array_merge(['grossBasic' => 50000, 'hraPercent' => 30], $gr),
        ];
    }

    private const NO_QUARTER = ['hasQuarter' => false, 'quarterId' => null, 'quarterRent' => 0];

    public function test_reload_without_a_quarter_keeps_stored_leave_adjusted_hra(): void
    {
        $out = $this->service()->applyAuthoritativeQuarterValues($this->payload(), self::NO_QUARTER, 2026, 9);
        $this->assertSame(11111.0, (float) $out['governmentMonthly']['hraPaid'], 'EOL/HPL-cut or typed HRA must survive a reload');
        $this->assertSame(15000.0, (float) $out['governmentMonthly']['hraActual']);
    }

    public function test_hra_is_restored_only_when_a_quarter_is_released(): void
    {
        $held = $this->payload(['hasQuarter' => true, 'quarterId' => 'q1', 'hraPaid' => 0, 'hraActual' => 0]);
        $out = $this->service()->applyAuthoritativeQuarterValues($held, self::NO_QUARTER, 2026, 9);
        $this->assertGreaterThan(0.0, (float) $out['governmentMonthly']['hraPaid']);
    }

    public function test_typed_rent_survives_while_same_quarter_stays_assigned_and_resets_on_reassignment(): void
    {
        $typed = $this->payload(
            ['hasQuarter' => true, 'quarterId' => 'q1', 'hraPaid' => 0, 'deductions' => ['quarterRent' => 75]],
            ['quarterRentManualOverride' => true, 'deductionPaidOverrides' => ['quarterRent' => 75]],
        );
        $same = $this->service()->applyAuthoritativeQuarterValues($typed, ['hasQuarter' => true, 'quarterId' => 'q1', 'quarterRent' => 138], 2026, 9);
        $this->assertSame(75.0, (float) $same['governmentMonthly']['deductions']['quarterRent']);
        $this->assertTrue($same['govRecalc']['quarterRentManualOverride']);

        $moved = $this->service()->applyAuthoritativeQuarterValues($typed, ['hasQuarter' => true, 'quarterId' => 'q2', 'quarterRent' => 138], 2026, 9);
        $this->assertSame(138.0, (float) $moved['governmentMonthly']['deductions']['quarterRent']);
        $this->assertFalse($moved['govRecalc']['quarterRentManualOverride']);
    }

    public function test_totals_stay_equal_to_components_after_reconcile(): void
    {
        $out = $this->service()->applyAuthoritativeQuarterValues($this->payload(), ['hasQuarter' => true, 'quarterId' => 'q1', 'quarterRent' => 138], 2026, 9);
        $gm = $out['governmentMonthly'];
        $this->assertSame([], \App\Support\PayrollTotals::reconcile($gm));
        $this->assertSame(0.0, (float) $gm['hraPaid']);
    }
}
