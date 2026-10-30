<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('cirt_payroll_edit_locks')) return;

        Schema::create('cirt_payroll_edit_locks', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->uuid('company_id');
            $table->string('period_key', 80);
            $table->unsignedSmallInteger('payroll_year');
            $table->unsignedSmallInteger('payroll_month');
            $table->uuid('payroll_period_id')->nullable();
            $table->uuid('owner_user_id');
            $table->uuid('client_id');
            $table->uuid('lease_token');
            $table->timestampTz('heartbeat_at');
            $table->timestampTz('expires_at');
            $table->timestampsTz();

            $table->foreign('company_id')->references('id')->on('cirt_institute')->cascadeOnDelete();
            $table->foreign('payroll_period_id')->references('id')->on('cirt_payroll_periods')->nullOnDelete();
            $table->foreign('owner_user_id')->references('id')->on('cirt_users')->cascadeOnDelete();
            $table->unique(['company_id', 'period_key', 'owner_user_id'], 'cirt_payroll_edit_lock_owner_unique');
            $table->index(['company_id', 'period_key', 'expires_at'], 'cirt_payroll_edit_lock_expiry_idx');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('cirt_payroll_edit_locks');
    }
};
