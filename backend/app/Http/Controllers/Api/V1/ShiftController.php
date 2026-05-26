<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Models\HrmsShift;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class ShiftController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $items = HrmsShift::where('company_id', $request->user()->company_id)
            ->orderBy('name')
            ->get();

        return response()->json(['shifts' => $items]);
    }

    public function store(Request $request): JsonResponse
    {
        $user = $request->user();
        $data = $request->validate([
            'name' => ['required', 'string', 'max:255'],
            'start_time' => ['required', 'date_format:H:i'],
            'end_time' => ['required', 'date_format:H:i'],
            'is_night_shift' => ['nullable', 'boolean'],
        ]);

        $exists = HrmsShift::where('company_id', $user->company_id)
            ->whereRaw('LOWER(name) = ?', [mb_strtolower($data['name'])])
            ->exists();

        if ($exists) {
            return response()->json(['error' => 'Shift name already exists'], 409);
        }

        $item = HrmsShift::create([...$data, 'company_id' => $user->company_id, 'is_active' => true]);

        return response()->json(['shift' => $item], 201);
    }

    public function update(Request $request, string $id): JsonResponse
    {
        $item = HrmsShift::findOrFail($id);
        $item->update($request->only(['name', 'start_time', 'end_time', 'is_night_shift', 'is_active']));

        return response()->json(['shift' => $item->refresh()]);
    }

    public function destroy(Request $request, string $id): JsonResponse
    {
        HrmsShift::findOrFail($id)->update(['is_active' => false]);

        return response()->json(['message' => 'Deactivated']);
    }
}
