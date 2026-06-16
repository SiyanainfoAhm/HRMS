<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('cirt_companies')) {
            return;
        }

        Schema::table('cirt_companies', function (Blueprint $table) {
            if (! Schema::hasColumn('cirt_companies', 'default_hra_percent')) {
                $table->decimal('default_hra_percent', 6, 2)->default(30)->after('default_da_percent');
            }
        });
    }

    public function down(): void
    {
        if (! Schema::hasTable('cirt_companies')) {
            return;
        }

        Schema::table('cirt_companies', function (Blueprint $table) {
            if (Schema::hasColumn('cirt_companies', 'default_hra_percent')) {
                $table->dropColumn('default_hra_percent');
            }
        });
    }
};
