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
            if (! Schema::hasColumn('cirt_companies', 'default_da_percent')) {
                $table->decimal('default_da_percent', 6, 2)->default(53)->after('professional_tax_monthly');
            }
        });
    }

    public function down(): void
    {
        if (! Schema::hasTable('cirt_companies')) {
            return;
        }

        Schema::table('cirt_companies', function (Blueprint $table) {
            if (Schema::hasColumn('cirt_companies', 'default_da_percent')) {
                $table->dropColumn('default_da_percent');
            }
        });
    }
};
