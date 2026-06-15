<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Models\HrmsCompany;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;

class CompanyController extends Controller
{
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
        $company->update($request->only([
            'name', 'code', 'industry',
            'address_line1', 'address_line2', 'city', 'state', 'country', 'postal_code',
            'phone', 'professional_tax_annual', 'professional_tax_monthly',
        ]));

        return response()->json(['company' => $company->refresh()]);
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
