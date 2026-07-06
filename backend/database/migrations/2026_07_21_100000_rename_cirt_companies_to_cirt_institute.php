<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Rename cirt_companies → cirt_institute (single CIRT organization profile).
 * company_id columns on child tables are unchanged; PostgreSQL FKs follow the rename.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('cirt_companies') && ! Schema::hasTable('cirt_institute')) {
            Schema::rename('cirt_companies', 'cirt_institute');
        }
    }

    public function down(): void
    {
        if (Schema::hasTable('cirt_institute') && ! Schema::hasTable('cirt_companies')) {
            Schema::rename('cirt_institute', 'cirt_companies');
        }
    }
};
