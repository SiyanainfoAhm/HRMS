<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Models\HrmsHoliday;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class HolidayController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $query = HrmsHoliday::where('company_id', $request->user()->company_id);

        if ($request->filled('year')) {
            $query->whereYear('holiday_date', $request->input('year'));
        }

        $holidays = $query->orderBy('holiday_date')->get();

        return response()->json(['holidays' => $holidays]);
    }

    public function store(Request $request): JsonResponse
    {
        $user = $request->user();
        if (! $user->role?->isManagerial()) {
            return response()->json(['error' => 'Forbidden'], 403);
        }

        $data = $request->validate([
            'name' => ['required', 'string', 'max:255'],
            'holiday_date' => ['required', 'date'],
            'holiday_end_date' => ['nullable', 'date', 'after_or_equal:holiday_date'],
            'is_optional' => ['nullable', 'boolean'],
            'location' => ['nullable', 'string'],
        ]);

        $data['company_id'] = $user->company_id;
        $holiday = HrmsHoliday::create($data);

        return response()->json(['holiday' => $holiday], 201);
    }

    public function update(Request $request, string $id): JsonResponse
    {
        $holiday = HrmsHoliday::findOrFail($id);
        $holiday->update($request->only([
            'name', 'holiday_date', 'holiday_end_date', 'is_optional', 'location',
        ]));

        return response()->json(['holiday' => $holiday->refresh()]);
    }

    public function destroy(Request $request, string $id): JsonResponse
    {
        HrmsHoliday::findOrFail($id)->delete();

        return response()->json(['message' => 'Deleted']);
    }
}
