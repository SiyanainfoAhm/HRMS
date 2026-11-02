<?php

namespace Tests\Unit;

use App\Http\Controllers\Api\V1\PayrollController;
use App\Models\HrmsElectricityTariff;
use App\Models\HrmsPayrollMaster;
use App\Models\HrmsUser;
use App\Services\ElectricityTariffService;
use App\Services\NightAllowanceRateService;
use App\Services\PayrollAmendmentService;
use App\Services\PayrollArrearService;
use App\Services\PayrollDraftService;
use App\Services\PayrollFieldService;
use App\Services\PayrollMasterService;
use App\Services\PayrollPreflightValidationService;
use App\Services\QuarterService;
use App\Support\PayrollTotals;
use Illuminate\Http\Exceptions\HttpResponseException;
use Illuminate\Support\Collection;
use PHPUnit\Framework\TestCase;
use ReflectionMethod;

/**
 * The server must not trust the browser: it rejects rows it cannot turn into a
 * payslip (naming the employee), recalculates electricity from units, keeps typed
 * amounts and never lets totals drift from their components.
 */
final class PayrollRunServerValidationTest extends TestCase
{
    /** response()->json() in the controller needs the Laravel container; boot it once, outside any test. */
    private static bool $booted = false;

    public static function setUpBeforeClass(): void
    {
        parent::setUpBeforeClass();
        if (! self::$booted) {
            $app = require dirname(__DIR__, 2).'/bootstrap/app.php';
            $app->make(\Illuminate\Contracts\Console\Kernel::class)->bootstrap();
            self::$booted = true;
        }
    }

    private function controller(?ElectricityTariffService $tariffs = null): PayrollController
    {
        // Several collaborators are final classes that cannot be mocked, and these
        // methods only need the tariff service, so skip the constructor.
        $controller = (new \ReflectionClass(PayrollController::class))->newInstanceWithoutConstructor();
        $service = $tariffs ?? $this->createMock(ElectricityTariffService::class);
        (function () use ($service): void {
            $this->electricityTariffService = $service; // readonly: first initialisation from class scope
        })->call($controller);

        return $controller;
    }

    private function call(PayrollController $c, string $method, array $args): mixed
    {
        $m = new ReflectionMethod($c, $method);

        return $m->invokeArgs($c, $args);
    }

    private function user(string $id, string $name): HrmsUser
    {
        $u = new HrmsUser;
        $u->forceFill(['id' => $id, 'name' => $name]);

        return $u;
    }

    private function goodRow(string $id, array $over = []): array
    {
        return array_merge([
            'employeeUserId' => $id, 'payDays' => 30,
            'governmentMonthly' => [
                'basicPaid' => 1000, 'deductions' => ['pt' => 100], 'totalEarnings' => 1000, 'totalDeductions' => 100, 'netSalary' => 900,
            ],
        ], $over);
    }

    /** @return array<int, array<string, string>> */
    private function problemsFor(array $rows, array $masterIds, Collection $users, Collection $masters, array $payslips = [], int $days = 30): array
    {
        try {
            $this->call($this->controller(), 'assertRunRowsProcessable', [$rows, $masterIds, $users, $masters, $payslips, [], $days]);
        } catch (HttpResponseException $e) {
            $this->assertSame(422, $e->getResponse()->getStatusCode());
            $body = json_decode($e->getResponse()->getContent(), true);
            $this->assertSame('PAYROLL_ROWS_NOT_PROCESSABLE', $body['code']);

            return $body['blockingErrors'];
        }

        return [];
    }

    public function test_run_rejects_unprocessable_rows_by_name_instead_of_skipping_them(): void
    {
        $users = collect(['a' => $this->user('a', 'Asha Rao'), 'b' => $this->user('b', 'Bhaskar Iyer'), 'c' => $this->user('c', 'Chitra Nair')]);
        $masters = collect(['a' => new HrmsPayrollMaster, 'c' => new HrmsPayrollMaster]);
        $rows = [
            $this->goodRow('a'),
            $this->goodRow('b'),                                   // no active master
            $this->goodRow('c', ['payDays' => 31]),                // 31 days in a 30-day month
            $this->goodRow('ghost'),                               // unknown employee
            $this->goodRow('a'),                                   // duplicate
        ];
        $problems = $this->problemsFor($rows, ['a' => 0, 'c' => 1], $users, $masters);
        $text = json_encode($problems);
        $this->assertStringContainsString('Bhaskar Iyer', $text);
        $this->assertStringContainsString('Chitra Nair', $text);
        $this->assertStringContainsString('payrollMaster', $text);
        $this->assertStringContainsString('payDays', $text);
        $this->assertStringContainsString('more than once', $text);
        $this->assertStringContainsString('not found', $text);
        $this->assertStringNotContainsString('Asha Rao', json_encode(array_filter($problems, fn ($p) => $p['field'] === 'payDays')));
    }

    public function test_run_accepts_a_clean_population(): void
    {
        $users = collect(['a' => $this->user('a', 'Asha Rao')]);
        $this->assertSame([], $this->problemsFor([$this->goodRow('a', ['payDays' => 0])], ['a' => 0], $users, collect(['a' => new HrmsPayrollMaster])));
    }

    public function test_run_rejects_a_salary_pending_master(): void
    {
        $users = collect(['a' => $this->user('a', 'Asha Rao')]);
        $row = $this->goodRow('a', ['govRecalc' => ['grossBasic' => 0]]);
        $problems = $this->problemsFor([$row], ['a' => 0], $users, collect(['a' => new HrmsPayrollMaster]));
        $this->assertSame('grossBasicPay', $problems[0]['field']);
        $this->assertStringContainsString('salary pending', $problems[0]['message']);
    }

    public function test_run_rejects_totals_that_do_not_match_their_components(): void
    {
        $users = collect(['a' => $this->user('a', 'Asha Rao')]);
        $bad = $this->goodRow('a');
        $bad['governmentMonthly']['netSalary'] = 950; // browser claims 950, components say 900
        $problems = $this->problemsFor([$bad], ['a' => 0], $users, collect(['a' => new HrmsPayrollMaster]));
        $this->assertSame('netSalary', $problems[0]['field']);
        $this->assertSame('Asha Rao', $problems[0]['employee']);
    }

    private function tariffService(): ElectricityTariffService
    {
        $tariff = [
            'id' => 't', 'effectiveFrom' => '2026-04-01', 'sthirAakar' => 130, 'vahanAakarPerUnit' => 1.6, 'fuelCharge' => 0, 'dutyPercentage' => 16,
            'slabs' => [
                ['fromUnit' => 0, 'toUnit' => 100, 'ratePerUnit' => 3.96, 'fuelChargePerUnit' => 0.35, 'sortOrder' => 1],
                ['fromUnit' => 101, 'toUnit' => 300, 'ratePerUnit' => 10.8, 'fuelChargePerUnit' => 0.65, 'sortOrder' => 2],
            ],
        ];
        $real = new ElectricityTariffService;
        $svc = $this->createMock(ElectricityTariffService::class);
        $svc->method('resolveForDate')->willReturn($this->createMock(HrmsElectricityTariff::class));
        $svc->method('formatTariff')->willReturn($tariff);
        $svc->method('calculateBill')->willReturnCallback(
            fn (float $u, ?array $t, bool $a, string $m, float $l, float $f, bool $o = false, ?float $ma = null) => $real->calculateBill($u, $t, $a, $m, $l, $f, $o, $ma),
        );

        return $svc;
    }

    private function master(): HrmsPayrollMaster
    {
        $m = new HrmsPayrollMaster;
        $m->forceFill(['electricity_mode' => 'manual_fixed', 'electricity_applicable' => true, 'electricity' => 49, 'electricity_default' => 49, 'has_quarter' => false]);

        return $m;
    }

    private function monthly(int $units, float $electricity = 49): array
    {
        return [
            'basicPaid' => 50000, 'totalEarnings' => 50000, 'electricityUnitsConsumed' => $units, 'electricityMode' => 'manual_fixed',
            'deductions' => ['pt' => 200, 'electricity' => $electricity, 'water' => 314.5],
            'totalDeductions' => 200 + $electricity + 314.5, 'netSalary' => 50000 - (200 + $electricity + 314.5),
        ];
    }

    public function test_authoritative_amounts_bill_units_from_tariff_not_the_master_flat_charge(): void
    {
        $out = $this->call($this->controller($this->tariffService()), 'applyAuthoritativeGovernmentPayrollAmounts', [$this->monthly(80), $this->master(), 'c', '2026-09-30']);
        $this->assertNotEquals(49.0, (float) $out['deductions']['electricity']);
        $this->assertGreaterThan(100, (float) $out['deductions']['electricity']);
        $this->assertSame(314.5, (float) $out['deductions']['water'], 'other components untouched');
        $this->assertSame([], PayrollTotals::reconcile($out), 'totals still equal their components, at 2 decimals');
        $this->assertEqualsWithDelta(50000 - $out['totalDeductions'], $out['netSalary'], 0.001, 'net is not rounded away from gross - deductions');
    }

    public function test_authoritative_amounts_keep_a_typed_electricity_amount_including_zero(): void
    {
        $out = $this->call($this->controller($this->tariffService()), 'applyAuthoritativeGovernmentPayrollAmounts', [$this->monthly(80, 0.0), $this->master(), 'c', '2026-09-30', true]);
        $this->assertSame(0.0, (float) $out['deductions']['electricity']);
        $this->assertTrue($out['electricityManualOverride']);
        $this->assertSame([], PayrollTotals::reconcile($out));
    }

    public function test_zero_units_keep_the_master_flat_charge(): void
    {
        $out = $this->call($this->controller($this->tariffService()), 'applyAuthoritativeGovernmentPayrollAmounts', [$this->monthly(0), $this->master(), 'c', '2026-09-30']);
        $this->assertSame(49.0, (float) $out['deductions']['electricity']);
    }
}
