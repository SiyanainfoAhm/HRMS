<?php

namespace Tests\Database;

use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;

/**
 * payroll:fold-special-pay on the synthetic TestWorld draft (Jan 2030): Special Pay moves into Special Allowance by a direct
 * JSON edit, the stored totals stay exactly as they are, and each employee gets an audit entry.
 */
final class FoldSpecialPayCommandTest extends DatabaseTestCase
{
    private function draftRow(): object
    {
        $draft = DB::table('cirt_payroll_drafts')->where('company_id', $this->world->company)->where('payroll_year', 2030)->where('payroll_month', 1)->where('status', 'draft')->first();
        $this->assertNotNull($draft, 'TestWorld seeds an open Jan 2030 draft');

        return DB::table('cirt_payroll_draft_employees')->where('payroll_draft_id', $draft->id)->first();
    }

    private function setSpecialPay(object $row, float $paid, float $actual, float $override): void
    {
        $p = json_decode($row->row_payload, true);
        $p['governmentMonthly']['spPayPaid'] = $paid;
        $p['governmentMonthly']['spPayActual'] = $actual;
        $p['govRecalc']['earningPaidOverrides']['spPayPaid'] = $override;
        DB::table('cirt_payroll_draft_employees')->where('id', $row->id)->update(['row_payload' => json_encode($p)]);
    }


    public function test_dry_run_changes_nothing_and_apply_moves_special_pay_with_totals_and_audit(): void
    {
        $admin = DB::table('cirt_users')->where('id', $this->world->adminId)->value('email');
        $row = $this->draftRow();
        $this->setSpecialPay($row, 300, 300, 300);
        $before = (array) DB::table('cirt_payroll_draft_employees')->where('id', $row->id)->first();
        $existingSa = (float) (json_decode($row->row_payload, true)['governmentMonthly']['customEarnings']['special_allowance'] ?? 0);

        $call = fn (bool $apply) => Artisan::call('payroll:fold-special-pay', ['--year' => 2030, '--month' => 1, '--user' => $admin] + ($apply ? ['--apply' => true] : []));
        $this->assertSame(0, $call(false));
        $this->assertSame((array) DB::table('cirt_payroll_draft_employees')->where('id', $row->id)->first(), $before, 'dry run: row identical');

        $this->assertSame(0, $call(true));
        $after = DB::table('cirt_payroll_draft_employees')->where('id', $row->id)->first();
        $p = json_decode($after->row_payload, true);
        $this->assertEquals(0, $p['governmentMonthly']['spPayPaid']);
        $this->assertEquals(0, $p['governmentMonthly']['spPayActual']);
        $this->assertEquals(0, $p['govRecalc']['earningPaidOverrides']['spPayPaid']);
        $this->assertEquals($existingSa + 300, $p['governmentMonthly']['customEarnings']['special_allowance']);
        $this->assertEquals($existingSa + 300, $p['govRecalc']['customEarnings']['special_allowance']);
        foreach (['gross_pay', 'total_earnings', 'total_deductions', 'net_pay', 'pay_days'] as $c) $this->assertEquals($before[$c], $after->{$c}, "$c unchanged");
        $this->assertSame((int) $before['version'] + 1, (int) $after->version);
        $audit = DB::table('cirt_payroll_draft_audits')->where('payroll_draft_id', $row->payroll_draft_id)->orderByDesc('created_at')->first();
        $this->assertSame($this->world->adminId, $audit->performed_by);
        $snap = json_decode($audit->employee_snapshot, true)[0];
        $this->assertSame('Special Pay moved to Special Allowance (field removed)', $snap['reason']);

        $this->assertSame(0, $call(true), 'second run: nothing left to move');
        $this->assertSame($after->row_payload, DB::table('cirt_payroll_draft_employees')->where('id', $row->id)->value('row_payload'));
    }

    public function test_disagreeing_special_pay_values_are_refused_and_roll_back(): void
    {
        $admin = DB::table('cirt_users')->where('id', $this->world->adminId)->value('email');
        $row = $this->draftRow();
        $this->setSpecialPay($row, 300, 200, 300);
        $payload = DB::table('cirt_payroll_draft_employees')->where('id', $row->id)->value('row_payload');
        $this->assertSame(1, Artisan::call('payroll:fold-special-pay', ['--year' => 2030, '--month' => 1, '--user' => $admin, '--apply' => true]));
        $this->assertSame($payload, DB::table('cirt_payroll_draft_employees')->where('id', $row->id)->value('row_payload'));
    }
}
