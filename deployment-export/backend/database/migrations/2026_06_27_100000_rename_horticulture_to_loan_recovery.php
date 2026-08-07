<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        $this->renameColumnIfExists('cirt_payroll_master', 'horticulture', 'loan_recovery');
        $this->renameColumnIfExists('cirt_payroll_master', 'horticulture_default', 'loan_recovery_default');

        if (Schema::hasTable('cirt_payroll_master_history')) {
            $this->renameColumnIfExists('cirt_payroll_master_history', 'horticulture', 'loan_recovery');
            $this->renameColumnIfExists('cirt_payroll_master_history', 'horticulture_default', 'loan_recovery_default');
        }

        if (Schema::hasTable('cirt_monthly_payroll')) {
            $this->renameColumnIfExists('cirt_monthly_payroll', 'horticulture_amount', 'loan_recovery_amount');
        }
    }

    public function down(): void
    {
        $this->renameColumnIfExists('cirt_payroll_master', 'loan_recovery', 'horticulture');
        $this->renameColumnIfExists('cirt_payroll_master', 'loan_recovery_default', 'horticulture_default');

        if (Schema::hasTable('cirt_payroll_master_history')) {
            $this->renameColumnIfExists('cirt_payroll_master_history', 'loan_recovery', 'horticulture');
            $this->renameColumnIfExists('cirt_payroll_master_history', 'loan_recovery_default', 'horticulture_default');
        }

        if (Schema::hasTable('cirt_monthly_payroll')) {
            $this->renameColumnIfExists('cirt_monthly_payroll', 'loan_recovery_amount', 'horticulture_amount');
        }
    }

    private function renameColumnIfExists(string $table, string $from, string $to): void
    {
        if (! Schema::hasTable($table)) {
            return;
        }
        if (! Schema::hasColumn($table, $from) || Schema::hasColumn($table, $to)) {
            return;
        }

        DB::statement(sprintf(
            'ALTER TABLE %s RENAME COLUMN %s TO %s',
            $table,
            $from,
            $to,
        ));
    }
};
