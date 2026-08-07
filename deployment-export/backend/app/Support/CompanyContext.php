<?php

namespace App\Support;

use App\Services\DefaultCompanyService;
use Illuminate\Http\Request;

/** Fixed single-organization company scope for CIRT Payroll. */
final class CompanyContext
{
    public static function id(?Request $request = null): string
    {
        $service = app(DefaultCompanyService::class);
        if ($request?->user()) {
            $service->ensureUserOnDefaultCompany($request->user());
        }

        return $service->getDefaultCompanyId();
    }

    /**
     * Strip untrusted company_id from request payloads; callers should assign CompanyContext::id() instead.
     *
     * @param  array<string, mixed>  $data
     * @return array<string, mixed>
     */
    public static function withoutUntrustedCompanyId(array $data): array
    {
        unset($data['company_id'], $data['companyId']);

        return $data;
    }
}
