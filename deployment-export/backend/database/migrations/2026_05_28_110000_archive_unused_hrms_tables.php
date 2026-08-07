<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\Schema;

/**
 * OPTIONAL — do not run unless unused HRMS module tables should be archived.
 * Renames dormant module tables to old_HRMS_* prefix (no drops).
 *
 * Confirm no application code references these tables before running.
 * Take a database backup before running.
 */
return new class extends Migration
{
    /** @var array<string, string> */
    private array $archives = [
        'HRMS_attendance_logs' => 'old_HRMS_attendance_logs',
        'HRMS_holidays' => 'old_HRMS_holidays',
        'HRMS_leave_policies' => 'old_HRMS_leave_policies',
        'HRMS_leave_requests' => 'old_HRMS_leave_requests',
        'HRMS_leave_types' => 'old_HRMS_leave_types',
        'HRMS_employee_invites' => 'old_HRMS_employee_invites',
        'HRMS_employee_document_submissions' => 'old_HRMS_employee_document_submissions',
        'HRMS_company_documents' => 'old_HRMS_company_documents',
        'HRMS_reimbursements' => 'old_HRMS_reimbursements',
        'HRMS_shifts' => 'old_HRMS_shifts',
        'HRMS_notifications' => 'old_HRMS_notifications',
    ];

    public function up(): void
    {
        if (! filter_var(env('CIRT_ARCHIVE_UNUSED_TABLES', false), FILTER_VALIDATE_BOOLEAN)) {
            return;
        }

        foreach ($this->archives as $from => $to) {
            $this->renameIfNeeded($from, $to);
        }
    }

    public function down(): void
    {
        if (! filter_var(env('CIRT_ARCHIVE_UNUSED_TABLES', false), FILTER_VALIDATE_BOOLEAN)) {
            return;
        }

        foreach (array_reverse($this->archives, true) as $from => $to) {
            $this->renameIfNeeded($to, $from);
        }
    }

    private function renameIfNeeded(string $from, string $to): void
    {
        if (! Schema::hasTable($from) || Schema::hasTable($to)) {
            return;
        }

        Schema::rename($from, $to);
    }
};
