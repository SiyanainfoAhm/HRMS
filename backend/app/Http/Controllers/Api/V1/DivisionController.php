<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Models\HrmsDivision;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class DivisionController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $divisions = HrmsDivision::where('company_id', $request->user()->company_id)
            ->orderBy('name')
            ->get();

        return response()->json(['divisions' => $divisions]);
    }

    public function store(Request $request): JsonResponse
    {
        $user = $request->user();
        $data = $request->validate([
            'name' => ['required', 'string', 'max:255'],
            'description' => ['nullable', 'string'],
        ]);

        $exists = HrmsDivision::where('company_id', $user->company_id)
            ->whereRaw('LOWER(name) = ?', [mb_strtolower($data['name'])])
            ->exists();

        if ($exists) {
            return response()->json(['error' => 'Division name already exists'], 409);
        }

        $division = HrmsDivision::create([...$data, 'company_id' => $user->company_id, 'is_active' => true]);

        return response()->json(['division' => $division], 201);
    }

    public function update(Request $request, string $id): JsonResponse
    {
        $division = HrmsDivision::findOrFail($id);
        $data = $request->validate([
            'name' => ['sometimes', 'string', 'max:255'],
            'description' => ['nullable', 'string'],
            'is_active' => ['nullable', 'boolean'],
        ]);

        if (isset($data['name'])) {
            $exists = HrmsDivision::where('company_id', $division->company_id)
                ->whereRaw('LOWER(name) = ?', [mb_strtolower($data['name'])])
                ->where('id', '!=', $id)
                ->exists();

            if ($exists) {
                return response()->json(['error' => 'Division name already exists'], 409);
            }
        }

        $division->update($data);

        return response()->json(['division' => $division->refresh()]);
    }

    public function destroy(Request $request, string $id): JsonResponse
    {
        $division = HrmsDivision::findOrFail($id);
        $division->update(['is_active' => false]);

        return response()->json(['message' => 'Deactivated']);
    }
}
