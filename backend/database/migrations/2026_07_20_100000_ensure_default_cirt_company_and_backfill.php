<?php

use App\Services\DefaultCompanyService;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('cirt_institute') && ! Schema::hasTable('cirt_companies')) {
            return;
        }

        $service = app(DefaultCompanyService::class);
        $service->forgetCachedId();
        $company = $service->getDefaultCompany();
        $companyId = (string) $company->id;

        $service->backfillCompanyIdOnTables(DefaultCompanyService::companyLinkedTables(), $companyId);
    }

    public function down(): void
    {
        // Data backfill is not reversed — company_id columns remain for FK safety.
    }
};
