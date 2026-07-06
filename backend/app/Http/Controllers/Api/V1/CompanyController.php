<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Models\HrmsCompany;
use App\Services\DefaultCompanyService;
use App\Services\PayrollArrearService;
use App\Services\PayrollMasterService;
use App\Support\CompanyContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Storage;

class CompanyController extends Controller
{
    public function __construct(
        private readonly PayrollMasterService $payrollMasterService,
        private readonly PayrollArrearService $payrollArrearService,
        private readonly DefaultCompanyService $defaultCompanyService,
    ) {}

    public function me(Request $request): JsonResponse
    {
        $this->defaultCompanyService->ensureUserOnDefaultCompany($request->user());
        $company = $this->defaultCompanyService->getDefaultCompany();

        return response()->json(['company' => $this->fixedOrganizationProfile($company)]);
    }

    /**
     * Legacy setup route — attaches admin to fixed CIRT company and optionally updates institute details.
     * Does not create a new organization record.
     */
    public function setup(Request $request): JsonResponse
    {
        $user = $request->user();
        $company = $this->defaultCompanyService->getDefaultCompany();
        $this->defaultCompanyService->ensureUserOnDefaultCompany($user);

        $data = $request->validate([
            'name' => ['sometimes', 'string', 'max:255'],
            'code' => ['sometimes', 'nullable', 'string', 'max:50'],
            'industry' => ['nullable', 'string', 'max:255'],
            'address_line1' => ['nullable', 'string'],
            'address_line2' => ['nullable', 'string'],
            'city' => ['nullable', 'string'],
            'state' => ['nullable', 'string'],
            'country' => ['nullable', 'string'],
            'postal_code' => ['nullable', 'string'],
            'phone' => ['nullable', 'string'],
            'professional_tax_annual' => ['nullable', 'numeric'],
            'professional_tax_monthly' => ['nullable', 'numeric'],
            'default_da_percent' => ['nullable', 'numeric', 'min:0', 'max:200'],
            'default_hra_percent' => ['nullable', 'numeric', 'min:0', 'max:200'],
        ]);

        unset($data['name'], $data['code']);
        if ($data !== []) {
            $company->update($data);
        }

        return response()->json(['company' => $this->fixedOrganizationProfile($company->refresh())]);
    }

    public function updateMe(Request $request): JsonResponse
    {
        $user = $request->user();
        if (! $user->role?->isManagerial()) {
            return response()->json(['error' => 'Forbidden'], 403);
        }

        $companyId = CompanyContext::id($request);
        $company = HrmsCompany::findOrFail($companyId);

        $payload = CompanyContext::withoutUntrustedCompanyId($request->only([
            'name', 'code', 'industry',
            'address_line1', 'address_line2', 'city', 'state', 'country', 'postal_code',
            'phone', 'professional_tax_annual', 'professional_tax_monthly', 'default_da_percent', 'default_hra_percent',
        ]));
        unset($payload['name'], $payload['code']);

        $request->validate([
            'default_da_percent' => ['sometimes', 'nullable', 'numeric', 'min:0', 'max:200'],
            'default_hra_percent' => ['sometimes', 'nullable', 'numeric', 'min:0', 'max:200'],
            'payroll_revision_effective_from' => ['nullable', 'date'],
            'apply_da_hra_revision' => ['nullable', 'boolean'],
        ]);

        $baselineDa = $this->payrollArrearService->getCurrentTargetDaPercent($companyId);
        $oldDa = (float) ($company->default_da_percent ?? $baselineDa ?? 53);
        $oldHra = (float) ($company->default_hra_percent ?? 30);
        $newDa = array_key_exists('default_da_percent', $payload)
            ? (float) ($payload['default_da_percent'] ?? $oldDa)
            : $oldDa;
        $newHra = array_key_exists('default_hra_percent', $payload)
            ? (float) ($payload['default_hra_percent'] ?? $oldHra)
            : $oldHra;

        $daChanged = abs($newDa - $oldDa) >= 0.001;
        $hraChanged = abs($newHra - $oldHra) >= 0.001;
        $payrollRevision = null;
        $daRevisionEvent = null;

        if ($payload !== []) {
            $company->update($payload);
        }

        if (($daChanged || $hraChanged) && $request->boolean('apply_da_hra_revision', true)) {
            $effectiveFrom = $request->input('payroll_revision_effective_from') ?? now()->toDateString();
            if (config('app.debug')) {
                Log::debug('company.settings_da_hra_revision', [
                    'company_id' => $companyId,
                    'old_da' => $oldDa,
                    'new_da' => $newDa,
                    'old_hra' => $oldHra,
                    'new_hra' => $newHra,
                    'effective_from' => $effectiveFrom,
                ]);
            }
            $revisionReason = sprintf(
                'Institute DA/HRA revision: DA %.2f%% → %.2f%%, HRA %.2f%% → %.2f%%',
                $oldDa,
                $newDa,
                $oldHra,
                $newHra,
            );
            $payrollRevision = $this->payrollMasterService->applyInstituteDaHraRevisionToPayrollMasters(
                $companyId,
                $newDa,
                $newHra,
                $effectiveFrom,
                $revisionReason,
                $user->id,
            );

            if ($daChanged && $newDa > $oldDa + 0.001) {
                $daRevisionEvent = $this->payrollArrearService->createRevisionEvent(
                    $companyId,
                    $oldDa,
                    $newDa,
                    $effectiveFrom,
                    sprintf('Institute DA revision: %.2f%% → %.2f%%', $oldDa, $newDa),
                    $user->id,
                );
            }
        }

        $arrearPreview = null;
        if ($daRevisionEvent) {
            $previewRunYear = (int) ($request->input('payroll_run_year') ?? $request->input('payrollRunYear') ?? 0);
            $previewRunMonth = (int) ($request->input('payroll_run_month') ?? $request->input('payrollRunMonth') ?? 0);
            $arrearPeriod = null;
            if ($previewRunYear >= 2000 && $previewRunMonth >= 1 && $previewRunMonth <= 12) {
                $arrearPeriod = $this->payrollArrearService->arrearPeriodForRevision(
                    $daRevisionEvent->effective_from->format('Y-m-d'),
                    $previewRunYear,
                    $previewRunMonth,
                );
            }
            $arrearPreview = [
                'revisionEventId' => $daRevisionEvent->id,
                'oldDaPercent' => $oldDa,
                'newDaPercent' => $newDa,
                'effectiveFrom' => $daRevisionEvent->effective_from->format('Y-m-d'),
                'pendingArrearPeriod' => $arrearPeriod ? [
                    'from' => $arrearPeriod['from']->format('Y-m-d'),
                    'to' => $arrearPeriod['to']->format('Y-m-d'),
                ] : null,
                'note' => $arrearPeriod === null && ($previewRunYear < 2000 || $previewRunMonth < 1)
                    ? 'Arrear months are calculated from the month you select on Run Payroll, not today\'s date.'
                    : null,
            ];
        }

        return response()->json([
            'company' => $this->fixedOrganizationProfile($company->refresh()),
            'payroll_revision' => $payrollRevision,
            'da_revision_event' => $daRevisionEvent,
            'arrear_preview' => $arrearPreview,
        ]);
    }

    public function uploadLogo(Request $request): JsonResponse
    {
        $user = $request->user();
        if (! $user->role?->isManagerial()) {
            return response()->json(['error' => 'Forbidden'], 403);
        }

        $request->validate(['logo' => ['required', 'image', 'max:2048']]);

        $path = $request->file('logo')->store('company-logos', 'public');
        $url = Storage::disk('public')->url($path);

        $company = HrmsCompany::findOrFail(CompanyContext::id($request));
        $company->update(['logo_url' => $url]);

        return response()->json(['logo_url' => $url]);
    }

    /**
     * @return array<string, mixed>
     */
    private function fixedOrganizationProfile(HrmsCompany $company): array
    {
        $profile = $company->toArray();
        $profile['name'] = (string) config('app.organization_name', 'CIRT');
        $profile['code'] = (string) config('app.default_company_code', 'CIRT');
        $profile['app_name'] = (string) config('app.name', 'CIRT Payroll');
        $profile['organization_name'] = $profile['name'];
        $profile['organization_name_editable'] = false;

        return $profile;
    }
}
