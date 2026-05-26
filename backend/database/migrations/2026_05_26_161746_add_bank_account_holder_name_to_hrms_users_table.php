<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('HRMS_users', function (Blueprint $table) {
            $table->string('bank_account_holder_name')->nullable()->after('bank_name');
        });
    }

    public function down(): void
    {
        Schema::table('HRMS_users', function (Blueprint $table) {
            $table->dropColumn('bank_account_holder_name');
        });
    }
};
