<?php

namespace App\Support;

use App\Models\HrmsEmployee;
use App\Models\HrmsUser;
use App\Services\DefaultCompanyService;
use Illuminate\Http\JsonResponse;

final class CompanyAccess
{
    public static function defaultCompanyId(): string
    {
        return app(DefaultCompanyService::class)->getDefaultCompanyId();
    }

    public static function belongsToDefaultCompany(?string $companyId): bool
    {
        if ($companyId === null) {
            return false;
        }

        return $companyId === self::defaultCompanyId();
    }

    public static function sameCompany(?string $viewerCompanyId, ?string $targetCompanyId): bool
    {
        if (! self::belongsToDefaultCompany($targetCompanyId)) {
            return false;
        }

        if ($viewerCompanyId === null || $targetCompanyId === null) {
            return false;
        }

        return $viewerCompanyId === $targetCompanyId;
    }

    public static function canViewUser(HrmsUser $viewer, HrmsUser $target): bool
    {
        if (! self::sameCompany($viewer->company_id, $target->company_id)) {
            return false;
        }

        if ($viewer->id === $target->id) {
            return true;
        }

        return $viewer->role?->isManagerial() ?? false;
    }

    public static function canViewEmployee(HrmsUser $viewer, HrmsEmployee $employee): bool
    {
        if (! self::sameCompany($viewer->company_id, $employee->company_id)) {
            return false;
        }

        if ($employee->user_id === $viewer->id) {
            return true;
        }

        return $viewer->role?->isManagerial() ?? false;
    }

    public static function notFound(): JsonResponse
    {
        return response()->json(['error' => 'Not found'], 404);
    }

    public static function forbidden(): JsonResponse
    {
        return response()->json(['error' => 'Forbidden'], 403);
    }
}
