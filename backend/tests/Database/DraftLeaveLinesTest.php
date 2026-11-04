<?php

namespace Tests\Database;

use App\Models\HrmsPayrollDraftAudit;
use App\Services\PayrollDraftService;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * A leaveLines change is only stored when every line has whole days from 1 up to the days of its month
 * (CIRT leave calculation, ADM:Gen:1521). A rejected save writes nothing. Runs on a throwaway period inside
 * the rolled-back test transaction.
 */
final class DraftLeaveLinesTest extends DatabaseTestCase
{
    private const YEAR = 2031;
    private const MONTH = 2;

    private function row(string $userId, array $leaveLines = []): array
    {
        $gr = [
            'grossBasic' => 43100, 'daPercent' => 63, 'hraPercent' => 30, 'medicalFixed' => 3000, 'payLevel' => 10,
            'electricityMode' => 'manual_fixed', 'electricityApplicable' => true, 'electricityManualOverride' => false,
            'deductionDefaults' => ['electricity' => 0, 'water' => 0, 'mess' => 0], 'deductionPaidOverrides' => [],
        ];
        if ($leaveLines !== []) {
            $gr['leaveLines'] = $leaveLines;
            $gr['hplDays'] = 1;
        }

        return [
            'employeeUserId' => $userId, 'payDays' => 28, 'grossPay' => 96126, 'deductions' => 1000, 'netPay' => 95126,
            'governmentMonthly' => [
                'basicPaid' => 43100, 'daPaid' => 27153, 'hraPaid' => 12930, 'medicalPaid' => 3000, 'transportPaid' => 5868,
                'deductions' => ['pt' => 200, 'cpf' => 800],
                'totalEarnings' => 96126, 'totalDeductions' => 1000, 'netSalary' => 95126,
            ],
            'govRecalc' => $gr,
        ];
    }

    private function seedDraft(): array
    {
        $company = $this->world->company;
        $user = $this->world->employees[0]['id'];
        $actor = (string) DB::table('cirt_users')->where('company_id', $company)->value('id');
        app(PayrollDraftService::class)->saveDraft($company, self::YEAR, self::MONTH, $actor, [$this->row($user)], null, true);

        return [$company, $user, $actor];
    }

    private function patch(string $company, string $user, string $actor, array $lines): void
    {
        $version = (int) DB::table('cirt_payroll_drafts')->where('payroll_year', self::YEAR)->where('payroll_month', self::MONTH)->value('version');
        app(PayrollDraftService::class)->saveDraft($company, self::YEAR, self::MONTH, $actor, [[
            'employeeUserId' => $user, 'employeeCode' => $this->world->employees[0]['code'], 'rowPayload' => $this->row($user, $lines), 'changedFields' => ['leaveLines'],
        ]], $version, false);
    }

    private function snapshot(string $user): array
    {
        $draft = DB::table('cirt_payroll_drafts')->where('payroll_year', self::YEAR)->where('payroll_month', self::MONTH)->first();
        $emp = DB::table('cirt_payroll_draft_employees')->where('payroll_draft_id', $draft->id)->where('employee_user_id', $user)->first();

        return [
            'draftVersion' => (int) $draft->version,
            'empVersion' => (int) $emp->version,
            'payload' => $emp->row_payload,
            'net' => $emp->net_pay,
            'audits' => HrmsPayrollDraftAudit::query()->where('payroll_draft_id', $draft->id)->count(),
        ];
    }

    public function test_45_days_in_september_is_rejected_with_the_message_and_nothing_is_written(): void
    {
        [$company, $user, $actor] = $this->seedDraft();
        $before = $this->snapshot($user);

        try {
            $this->patch($company, $user, $actor, [['type' => 'HPL', 'month' => 9, 'year' => 2026, 'days' => 45]]);
            $this->fail('A 45-day leave line in September must be rejected.');
        } catch (ValidationException $e) {
            $message = $e->errors()['leaveLines'][0] ?? '';
            $this->assertStringContainsString('Fix leave lines for T1 before saving', $message);
            $this->assertStringContainsString('whole number from 1 to the days in that month', $message);
        }

        $this->assertSame($before, $this->snapshot($user), 'draft version, employee row, totals and audit log are all unchanged');
    }

    public function test_zero_and_fractional_days_are_rejected_too(): void
    {
        [$company, $user, $actor] = $this->seedDraft();
        $before = $this->snapshot($user);

        foreach ([0, 2.5] as $days) {
            try {
                $this->patch($company, $user, $actor, [['type' => 'EOL', 'month' => 9, 'year' => 2026, 'days' => $days]]);
                $this->fail("{$days} days must be rejected.");
            } catch (ValidationException $e) {
                $this->assertArrayHasKey('leaveLines', $e->errors());
            }
        }
        $this->assertSame($before, $this->snapshot($user));
    }

    public function test_valid_lines_save_and_duplicate_lines_do_not_block(): void
    {
        [$company, $user, $actor] = $this->seedDraft();

        $this->patch($company, $user, $actor, [
            ['type' => 'HPL', 'month' => 9, 'year' => 2026, 'days' => 30],
            ['type' => 'HPL', 'month' => 9, 'year' => 2026, 'days' => 1], // duplicate type + month: a warning in the UI, not an error
            ['type' => 'EOL', 'month' => 10, 'year' => 2026, 'days' => 31],
        ]);

        $stored = json_decode((string) DB::table('cirt_payroll_draft_employees')->where('employee_user_id', $user)
            ->whereIn('payroll_draft_id', DB::table('cirt_payroll_drafts')->where('payroll_year', self::YEAR)->where('payroll_month', self::MONTH)->pluck('id'))
            ->value('row_payload'), true);
        $this->assertCount(3, $stored['govRecalc']['leaveLines'], 'all three lines are stored as typed');
        $this->assertSame(30, (int) $stored['govRecalc']['leaveLines'][0]['days']);
    }
}
