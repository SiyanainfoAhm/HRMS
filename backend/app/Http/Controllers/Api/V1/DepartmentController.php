<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Models\HrmsDepartment;
use App\Models\HrmsEmployee;
use App\Models\HrmsUser;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class DepartmentController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $depts = HrmsDepartment::where('company_id', $request->user()->company_id)
            ->with('division')
            ->orderBy('name')
            ->get();

        return response()->json(['departments' => $depts]);
    }

    public function store(Request $request): JsonResponse
    {
        $user = $request->user();
        $data = $request->validate([
            'name' => ['required', 'string', 'max:255'],
            'description' => ['nullable', 'string'],
            'division_id' => ['nullable', 'uuid'],
        ]);

        $exists = HrmsDepartment::where('company_id', $user->company_id)
            ->whereRaw('LOWER(name) = ?', [mb_strtolower($data['name'])])
            ->exists();

        if ($exists) {
            return response()->json(['error' => 'Department name already exists'], 409);
        }

        $dept = HrmsDepartment::create([...$data, 'company_id' => $user->company_id, 'is_active' => true]);

        return response()->json(['department' => $dept], 201);
    }

    public function update(Request $request, string $id): JsonResponse
    {
        $dept = HrmsDepartment::findOrFail($id);
        $data = $request->validate([
            'name' => ['sometimes', 'string', 'max:255'],
            'description' => ['nullable', 'string'],
            'division_id' => ['nullable', 'uuid'],
            'is_active' => ['nullable', 'boolean'],
        ]);

        if (isset($data['name'])) {
            $exists = HrmsDepartment::where('company_id', $dept->company_id)
                ->whereRaw('LOWER(name) = ?', [mb_strtolower($data['name'])])
                ->where('id', '!=', $id)
                ->exists();

            if ($exists) {
                return response()->json(['error' => 'Department name already exists'], 409);
            }
        }

        $dept->update($data);

        return response()->json(['department' => $dept->refresh()]);
    }

    public function destroy(Request $request, string $id): JsonResponse
    {
        $companyId = (string) $request->user()->company_id;
        $dept = HrmsDepartment::where('company_id', $companyId)->findOrFail($id);

        $employeeCount = HrmsEmployee::where('company_id', $companyId)
            ->where('department_id', $id)
            ->count();
        $userCount = HrmsUser::where('company_id', $companyId)
            ->where('department_id', $id)
            ->count();
        if ($employeeCount + $userCount > 0) {
            return response()->json([
                'error' => 'Cannot delete: employees are assigned to this department.',
            ], 409);
        }

        $dept->delete();

        return response()->json(['message' => 'Deleted']);
    }
}
