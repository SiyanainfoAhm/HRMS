<?php

namespace Tests\Database;

use App\Models\HrmsNightAllowanceRate;
use App\Services\NightAllowanceRateService;
use Illuminate\Support\Facades\DB;

/**
 * 2026_11_03_110000: only slab rows whose stored per-duty rate is exactly 8x the table value are
 * corrected; everything else is left alone; running it again changes nothing. Settings stores
 * the typed per-duty amount exactly (no x8 or /8).
 */
final class NightAllowanceRatesCorrectionTest extends DatabaseTestCase
{
    use FinalizedPayrollSnapshot;

    private const TABLE = [
        1 => [1, '23.20'], 2 => [2, '26.10'], 3 => [3, '28.85'], 4 => [4, '32.65'], 5 => [5, '36.55'],
        6 => [5, '38.05'], 7 => [5, '39.60'], 8 => [5, '41.25'], 9 => [6, '43.50'], 10 => [6, '46.00'],
        11 => [7, '50.40'], 12 => [8, '55.45'], 13 => [8, '58.55'], 14 => [9, '63.60'],
    ];

    private function migrate(): void
    {
        (require base_path('database/migrations/2026_11_03_110000_correct_night_allowance_rates_8x.php'))->up();
    }

    /** @return array<int, string> */
    private function perDuty(string $company): array
    {
        return DB::table('cirt_night_allowance_rates')->where('company_id', $company)->whereBetween('slab_no', [1, 14])
            ->pluck('rate_per_duty', 'slab_no')->map(fn ($v) => number_format((float) $v, 2, '.', ''))->all();
    }

    public function test_only_exact_8x_rows_are_corrected_and_the_migration_is_idempotent(): void
    {
        $snapshot = $this->finalizedSnapshot();
        $company = DB::table('cirt_night_allowance_rates')->value('company_id');
        $company !== null || $this->markTestSkipped('No night allowance rates in this database.');

        // Put the company back into the 8x state, with slab 3 edited by a user (200.00) and slab 14 unrelated (500.00).
        foreach (self::TABLE as $slab => [$level, $amount]) {
            DB::table('cirt_night_allowance_rates')->where('company_id', $company)->where('slab_no', $slab)
                ->update(['pay_level' => $level, 'rate_per_hour' => $amount, 'rate_per_duty' => round((float) $amount * 8, 2)]);
        }
        DB::table('cirt_night_allowance_rates')->where('company_id', $company)->where('slab_no', 3)->update(['rate_per_duty' => '200.00']);
        DB::table('cirt_night_allowance_rates')->where('company_id', $company)->where('slab_no', 14)->update(['rate_per_duty' => '500.00']);

        $this->migrate();
        $after = $this->perDuty((string) $company);
        foreach (self::TABLE as $slab => [$level, $amount]) {
            $expected = match ($slab) {
                3 => '200.00',
                14 => '500.00',
                default => $amount,
            };
            $this->assertSame($expected, $after[$slab], "slab $slab");
        }

        $this->migrate(); // idempotent
        $this->assertSame($after, $this->perDuty((string) $company));
        $this->assertFinalizedUnchanged($snapshot, 'the night allowance rate correction');
    }

    public function test_settings_stores_the_per_duty_amount_exactly_as_typed(): void
    {
        $company = DB::table('cirt_night_allowance_rates')->value('company_id');
        $company !== null || $this->markTestSkipped('No night allowance rates in this database.');
        $svc = app(NightAllowanceRateService::class);

        $row = $svc->create((string) $company, ['slabNo' => 9001, 'payLevel' => 1, 'ratePerDuty' => 23.2, 'isActive' => true]);
        $this->assertSame(23.2, $row['ratePerDuty'], 'stored exactly as typed, no x8 or /8');
        $stored = DB::table('cirt_night_allowance_rates')->where('id', $row['id'])->first();
        $this->assertSame('23.20', number_format((float) $stored->rate_per_duty, 2, '.', ''));
        $this->assertSame('23.20', number_format((float) $stored->rate_per_hour, 2, '.', ''), 'legacy column holds the same amount');

        $model = HrmsNightAllowanceRate::query()->findOrFail($row['id']);
        $updated = $svc->update($model, ['ratePerDuty' => 57.35]);
        $this->assertSame(57.35, $updated['ratePerDuty']);
        $this->assertStringContainsString('57.35/duty', $updated['label']);
    }
}
