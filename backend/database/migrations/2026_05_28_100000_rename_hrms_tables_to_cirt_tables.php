<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Renames active payroll tables from HRMS_* to cirt_*.
 * Idempotent: skips if source missing or target already exists.
 *
 * Take a database backup before running: pg_dump ...
 */
return new class extends Migration
{
    /** @var array<string, string> */
    private array $renames = [
        'HRMS_users' => 'cirt_users',
        'HRMS_roles' => 'cirt_roles',
        'HRMS_companies' => 'cirt_companies',
        'HRMS_departments' => 'cirt_departments',
        'HRMS_designations' => 'cirt_designations',
        'HRMS_divisions' => 'cirt_divisions',
        'HRMS_employees' => 'cirt_employees',
        'HRMS_employee_bank_accounts' => 'cirt_employee_bank_accounts',
        'HRMS_payroll_master' => 'cirt_payroll_master',
        'HRMS_payroll_periods' => 'cirt_payroll_periods',
        'HRMS_government_monthly_payroll' => 'cirt_monthly_payroll',
        'HRMS_payslips' => 'cirt_payslips',
        'HRMS_payroll_rule_settings' => 'cirt_payroll_rule_settings',
        'HRMS_payroll_import_batches' => 'cirt_payroll_import_batches',
    ];

    public function up(): void
    {
        foreach ($this->renames as $from => $to) {
            $this->renameIfNeeded($from, $to);
        }
    }

    public function down(): void
    {
        foreach (array_reverse($this->renames, true) as $from => $to) {
            $this->renameIfNeeded($to, $from);
        }
    }

    private function renameIfNeeded(string $from, string $to): void
    {
        if (! $this->tableExists($from) || $this->tableExists($to)) {
            return;
        }

        if ($this->needsQuotedRename($from)) {
            DB::statement(sprintf('ALTER TABLE public."%s" RENAME TO %s', str_replace('"', '', $from), $to));

            return;
        }

        Schema::rename($from, $to);
    }

    private function tableExists(string $name): bool
    {
        if (Schema::hasTable($name)) {
            return true;
        }

        $row = DB::selectOne(
            'SELECT EXISTS (
                SELECT 1 FROM information_schema.tables
                WHERE table_schema = ? AND table_name = ?
            ) AS "exists"',
            ['public', $name]
        );

        return (bool) ($row->exists ?? false);
    }

    private function needsQuotedRename(string $name): bool
    {
        return str_contains($name, 'HRMS_') || preg_match('/[A-Z]/', $name) === 1;
    }
};
