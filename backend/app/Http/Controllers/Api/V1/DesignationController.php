<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Models\HrmsDesignation;
use App\Models\HrmsEmployee;
use App\Models\HrmsUser;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class DesignationController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $items = HrmsDesignation::where('company_id', $request->user()->company_id)
            ->orderBy('title')
            ->get();

        return response()->json(['designations' => $items]);
    }

    public function store(Request $request): JsonResponse
    {
        $user = $request->user();
        $data = $request->validate([
            'title' => ['required', 'string', 'max:255'],
            'level' => ['nullable', 'integer'],
        ]);

        $exists = HrmsDesignation::where('company_id', $user->company_id)
            ->whereRaw('LOWER(title) = ?', [mb_strtolower($data['title'])])
            ->exists();

        if ($exists) {
            return response()->json(['error' => 'Designation already exists'], 409);
        }

        $item = HrmsDesignation::create([...$data, 'company_id' => $user->company_id, 'is_active' => true]);

        return response()->json(['designation' => $item], 201);
    }

    public function update(Request $request, string $id): JsonResponse
    {
        $item = HrmsDesignation::findOrFail($id);
        $data = $request->validate([
            'title' => ['sometimes', 'string', 'max:255'],
            'level' => ['nullable', 'integer'],
            'is_active' => ['nullable', 'boolean'],
        ]);

        if (isset($data['title'])) {
            $exists = HrmsDesignation::where('company_id', $item->company_id)
                ->whereRaw('LOWER(title) = ?', [mb_strtolower($data['title'])])
                ->where('id', '!=', $id)
                ->exists();

            if ($exists) {
                return response()->json(['error' => 'Designation already exists'], 409);
            }
        }

        $item->update($data);

        return response()->json(['designation' => $item->refresh()]);
    }

    public function destroy(Request $request, string $id): JsonResponse
    {
        $companyId = (string) $request->user()->company_id;
        $item = HrmsDesignation::where('company_id', $companyId)->findOrFail($id);

        $employeeCount = HrmsEmployee::where('company_id', $companyId)
            ->where('designation_id', $id)
            ->count();
        $userCount = HrmsUser::where('company_id', $companyId)
            ->where('designation_id', $id)
            ->count();
        if ($employeeCount + $userCount > 0) {
            return response()->json([
                'error' => 'Cannot delete: employees are assigned to this designation.',
            ], 409);
        }

        $item->delete();

        return response()->json(['message' => 'Deleted']);
    }
}
