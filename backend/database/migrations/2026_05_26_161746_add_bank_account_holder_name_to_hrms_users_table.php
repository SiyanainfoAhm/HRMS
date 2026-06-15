<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    private function usersTable(): string
    {
        if (Schema::hasTable('cirt_users')) {
            return 'cirt_users';
        }

        return 'HRMS_users';
    }

    public function up(): void
    {
        $table = $this->usersTable();
        if (! Schema::hasTable($table) || Schema::hasColumn($table, 'bank_account_holder_name')) {
            return;
        }

        Schema::table($table, function (Blueprint $table) {
            $table->string('bank_account_holder_name')->nullable()->after('bank_name');
        });
    }

    public function down(): void
    {
        $table = $this->usersTable();
        if (! Schema::hasTable($table) || ! Schema::hasColumn($table, 'bank_account_holder_name')) {
            return;
        }

        Schema::table($table, function (Blueprint $table) {
            $table->dropColumn('bank_account_holder_name');
        });
    }
};
