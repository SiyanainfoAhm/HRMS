<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('HRMS_leave_types')) {
            return;
        }

        if (! Schema::hasColumn('HRMS_leave_types', 'payslip_slot')) {
            DB::statement('ALTER TABLE "HRMS_leave_types" ADD COLUMN payslip_slot text NULL');
        }

        DB::statement(<<<'SQL'
DO $$
BEGIN
  ALTER TABLE "HRMS_leave_types"
    ADD CONSTRAINT hrms_leave_types_payslip_slot_chk
    CHECK (payslip_slot IS NULL OR payslip_slot IN ('CL', 'EL', 'HPL', 'HL'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
SQL);
    }

    public function down(): void
    {
        if (! Schema::hasTable('HRMS_leave_types') || ! Schema::hasColumn('HRMS_leave_types', 'payslip_slot')) {
            return;
        }

        DB::statement('ALTER TABLE "HRMS_leave_types" DROP CONSTRAINT IF EXISTS hrms_leave_types_payslip_slot_chk');
        DB::statement('ALTER TABLE "HRMS_leave_types" DROP COLUMN IF EXISTS payslip_slot');
    }
};
