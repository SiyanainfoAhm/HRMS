<?php

namespace Tests\Database;

use Illuminate\Support\Facades\DB;

/**
 * Fingerprint of every FINALIZED payroll artefact (generated monthly rows, payslips,
 * finalized drafts and their employee rows). A CIRT-FIX change must leave this
 * byte-identical: historical payroll never changes.
 */
trait FinalizedPayrollSnapshot
{
    /** @return array<string, string> table => md5 of the ordered JSON rows */
    protected function finalizedSnapshot(): array
    {
        $hash = fn (string $sql): string => md5(implode("\n", array_map(
            static fn ($r) => (string) $r->j,
            DB::select($sql),
        )));

        return [
            'cirt_monthly_payroll' => $hash('select row_to_json(t)::text j from cirt_monthly_payroll t order by id'),
            'cirt_payslips' => $hash('select row_to_json(t)::text j from cirt_payslips t order by id'),
            'cirt_payroll_drafts(finalized)' => $hash("select row_to_json(t)::text j from cirt_payroll_drafts t where status = 'finalized' order by id"),
            'cirt_payroll_draft_employees(finalized)' => $hash("select row_to_json(e)::text j from cirt_payroll_draft_employees e join cirt_payroll_drafts d on d.id = e.payroll_draft_id where d.status = 'finalized' order by e.id"),
            'cirt_payroll_periods' => $hash('select row_to_json(t)::text j from cirt_payroll_periods t order by id'),
        ];
    }

    protected function assertFinalizedUnchanged(array $before, string $what): void
    {
        $this->assertSame($before, $this->finalizedSnapshot(), "{$what} must not change finalized payroll");
    }
}
