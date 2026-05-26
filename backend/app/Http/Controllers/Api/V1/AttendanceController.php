<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Models\HrmsAttendanceLog;
use App\Models\HrmsEmployee;
use Carbon\Carbon;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class AttendanceController extends Controller
{
    public function me(Request $request): JsonResponse
    {
        $user = $request->user();
        $employee = HrmsEmployee::where('user_id', $user->id)->first();

        if (! $employee) {
            return response()->json(['error' => 'No employee record found'], 404);
        }

        $query = HrmsAttendanceLog::where('employee_id', $employee->id);

        if ($request->filled('month')) {
            $start = Carbon::createFromFormat('Y-m', $request->input('month'))->startOfMonth();
            $end = (clone $start)->endOfMonth();
            $query->whereBetween('work_date', [$start->toDateString(), $end->toDateString()]);
        }

        $logs = $query->orderBy('work_date', 'desc')->get();

        return response()->json(['attendance' => $logs, 'employee' => $employee]);
    }

    public function punch(Request $request): JsonResponse
    {
        $user = $request->user();
        $data = $request->validate([
            'action' => ['required', 'in:check_in,check_out,lunch_out,lunch_in,tea_out,tea_in'],
            'lat' => ['nullable', 'numeric'],
            'lng' => ['nullable', 'numeric'],
        ]);

        $employee = HrmsEmployee::where('user_id', $user->id)->first();
        if (! $employee) {
            return response()->json(['error' => 'No employee record'], 404);
        }

        $today = Carbon::now('Asia/Kolkata')->toDateString();
        $now = Carbon::now('Asia/Kolkata');

        $existing = HrmsAttendanceLog::where('employee_id', $employee->id)
            ->where('work_date', $today)
            ->first();

        $action = $data['action'];

        if ($action === 'check_in') {
            if ($existing) {
                return response()->json(['error' => 'Already checked in today'], 409);
            }

            $log = HrmsAttendanceLog::create([
                'company_id' => $employee->company_id,
                'employee_id' => $employee->id,
                'work_date' => $today,
                'check_in_at' => $now,
                'check_in_lat' => $data['lat'] ?? null,
                'check_in_lng' => $data['lng'] ?? null,
                'status' => 'present',
            ]);

            return response()->json(['attendance' => $log], 201);
        }

        if (! $existing) {
            return response()->json(['error' => 'Not checked in today'], 400);
        }

        $update = [];

        switch ($action) {
            case 'check_out':
                $update['check_out_at'] = $now;
                $update['check_out_lat'] = $data['lat'] ?? null;
                $update['check_out_lng'] = $data['lng'] ?? null;
                if ($existing->check_in_at) {
                    $checkIn = Carbon::parse($existing->check_in_at);
                    $totalMinutes = $checkIn->diffInMinutes($now);
                    $breakMins = (int) ($existing->break_minutes ?? 0);
                    $update['total_hours'] = round(($totalMinutes - $breakMins) / 60, 2);
                }
                break;
            case 'lunch_out':
                $update['lunch_check_out_at'] = $now;
                $update['lunch_break_started_at'] = $now;
                break;
            case 'lunch_in':
                $update['lunch_check_in_at'] = $now;
                $update['lunch_break_started_at'] = null;
                if ($existing->lunch_check_out_at) {
                    $mins = Carbon::parse($existing->lunch_check_out_at)->diffInMinutes($now);
                    $update['break_minutes'] = (int) ($existing->break_minutes ?? 0) + $mins;
                }
                break;
            case 'tea_out':
                $update['tea_check_out_at'] = $now;
                $update['tea_break_started_at'] = $now;
                break;
            case 'tea_in':
                $update['tea_check_in_at'] = $now;
                $update['tea_break_started_at'] = null;
                if ($existing->tea_check_out_at) {
                    $mins = Carbon::parse($existing->tea_check_out_at)->diffInMinutes($now);
                    $update['break_minutes'] = (int) ($existing->break_minutes ?? 0) + $mins;
                }
                break;
        }

        $existing->update($update);

        return response()->json(['attendance' => $existing->refresh()]);
    }

    public function company(Request $request): JsonResponse
    {
        $user = $request->user();
        if (! $user->role?->isManagerial()) {
            return response()->json(['error' => 'Forbidden'], 403);
        }

        $query = HrmsAttendanceLog::where('HRMS_attendance_logs.company_id', $user->company_id)
            ->join('HRMS_employees', 'HRMS_attendance_logs.employee_id', '=', 'HRMS_employees.id')
            ->select('HRMS_attendance_logs.*', 'HRMS_employees.first_name', 'HRMS_employees.last_name', 'HRMS_employees.email as employee_email');

        if ($request->filled('date')) {
            $query->where('work_date', $request->input('date'));
        } elseif ($request->filled('month')) {
            $start = Carbon::createFromFormat('Y-m', $request->input('month'))->startOfMonth();
            $end = (clone $start)->endOfMonth();
            $query->whereBetween('work_date', [$start->toDateString(), $end->toDateString()]);
        }

        $logs = $query->orderBy('work_date', 'desc')->get();

        return response()->json(['attendance' => $logs]);
    }
}
