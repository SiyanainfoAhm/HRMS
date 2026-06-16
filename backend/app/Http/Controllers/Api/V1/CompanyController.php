<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Models\HrmsCompany;
use App\Services\PayrollMasterService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;

class CompanyController extends Controller
{
    public function __construct(
        private readonly PayrollMasterService $payrollMasterService,
    ) {}

    public function me(Request $request): JsonResponse
    {
        $user = $request->user();
        if (! $user->company_id) {
            return response()->json(['company' => null]);
        }

        return response()->json(['company' => HrmsCompany::find($user->company_id)]);
    }

    public function setup(Request $request): JsonResponse
    {
        $user = $request->user();
        $data = $request->validate([
            'name' => ['required', 'string', 'max:255'],
            'code' => ['nullable', 'string', 'max:50'],
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

        $company = HrmsCompany::create($data);
        $user->update(['company_id' => $company->id]);

        return response()->json(['company' => $company], 201);
    }

    public function updateMe(Request $request): JsonResponse
    {
        $user = $request->user();
        if (! $user->company_id || ! $user->role?->isManagerial()) {
            return response()->json(['error' => 'Forbidden'], 403);
        }

        $company = HrmsCompany::findOrFail($user->company_id);

        $payload = $request->only([
            'name', 'code', 'industry',
            'address_line1', 'address_line2', 'city', 'state', 'country', 'postal_code',
            'phone', 'professional_tax_annual', 'professional_tax_monthly', 'default_da_percent', 'default_hra_percent',
        ]);

        $request->validate([
            'default_da_percent' => ['sometimes', 'nullable', 'numeric', 'min:0', 'max:200'],
            'default_hra_percent' => ['sometimes', 'nullable', 'numeric', 'min:0', 'max:200'],
            'payroll_revision_effective_from' => ['nullable', 'date'],
            'apply_da_hra_revision' => ['nullable', 'boolean'],
        ]);

        $oldDa = (float) ($company->default_da_percent ?? 53);
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

        $company->update($payload);

        if (($daChanged || $hraChanged) && $request->boolean('apply_da_hra_revision', true)) {
            $effectiveFrom = $request->input('payroll_revision_effective_from') ?? now()->toDateString();
            $payrollRevision = $this->payrollMasterService->revisionizeForCompanyDaHraChange(
                (string) $user->company_id,
                $newDa,
                $newHra,
                $effectiveFrom,
                $user->id,
            );
        }

        return response()->json([
            'company' => $company->refresh(),
            'payroll_revision' => $payrollRevision,
        ]);
    }

    public function uploadLogo(Request $request): JsonResponse
    {
        $user = $request->user();
        if (! $user->company_id) {
            return response()->json(['error' => 'No company'], 400);
        }

        $request->validate(['logo' => ['required', 'image', 'max:2048']]);

        $path = $request->file('logo')->store('company-logos', 'public');
        $url = Storage::disk('public')->url($path);

        $company = HrmsCompany::findOrFail($user->company_id);
        $company->update(['logo_url' => $url]);

        return response()->json(['logo_url' => $url]);
    }
}
