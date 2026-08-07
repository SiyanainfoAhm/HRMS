<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Models\HrmsRole;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class RoleController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $roles = HrmsRole::where('company_id', $request->user()->company_id)
            ->orderBy('name')
            ->get();

        return response()->json(['roles' => $roles]);
    }

    public function store(Request $request): JsonResponse
    {
        $user = $request->user();
        $data = $request->validate([
            'role_key' => ['required', 'in:admin,employee'],
            'name' => ['required', 'string', 'max:255'],
            'description' => ['nullable', 'string'],
            'is_default' => ['nullable', 'boolean'],
        ]);

        $exists = HrmsRole::where('company_id', $user->company_id)
            ->where('role_key', $data['role_key'])
            ->exists();

        if ($exists) {
            return response()->json(['error' => 'Role key already exists for this company'], 409);
        }

        $role = HrmsRole::create([...$data, 'company_id' => $user->company_id, 'is_active' => true]);

        return response()->json(['role' => $role], 201);
    }

    public function update(Request $request, string $id): JsonResponse
    {
        $role = HrmsRole::findOrFail($id);
        $role->update($request->only(['name', 'description', 'is_default', 'is_active']));

        return response()->json(['role' => $role->refresh()]);
    }

    public function destroy(Request $request, string $id): JsonResponse
    {
        HrmsRole::findOrFail($id)->update(['is_active' => false]);

        return response()->json(['message' => 'Deactivated']);
    }
}
