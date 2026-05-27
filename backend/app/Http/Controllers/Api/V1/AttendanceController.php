<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Models\HrmsAttendanceLog;
use App\Models\HrmsEmployee;
use App\Support\EmployeeRecordService;
use Carbon\Carbon;
use Illuminate\Database\QueryException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Schema;

class AttendanceController extends Controller
{
    private const MANDATORY_LUNCH_MINUTES = 60;

    private const MIN_GROSS_FOR_MANDATORY_LUNCH = 240;

    /** @var array<string, int>|null */
    private static ?array $attendanceColumns = null;

    /** Dashboard: today's punch state for the logged-in user. */
    public function today(Request $request): JsonResponse
    {
        $user = $request->user();
        if (! $user->company_id) {
            return response()->json([
                'hasEmployee' => false,
                'workDate' => Carbon::now('Asia/Kolkata')->toDateString(),
                'log' => null,
            ]);
        }

        $employee = EmployeeRecordService::forUser($user);
        $today = Carbon::now('Asia/Kolkata')->toDateString();

        $log = HrmsAttendanceLog::where('employee_id', $employee->id)
            ->where('work_date', $today)
            ->first();

        return response()->json([
            'hasEmployee' => true,
            'workDate' => $today,
            'log' => $this->formatDashboardLog($log),
        ]);
    }

    public function me(Request $request): JsonResponse
    {
        $user = $request->user();

        if (! $user->company_id) {
            return response()->json(['hasEmployee' => false, 'rows' => [], 'total' => 0]);
        }

        $employee = EmployeeRecordService::forUser($user);
        $query = HrmsAttendanceLog::where('employee_id', $employee->id);

        $startDate = $request->input('start_date') ?? $request->input('startDate');
        $endDate = $request->input('end_date') ?? $request->input('endDate');

        if ($startDate && $endDate) {
            $query->whereBetween('work_date', [$startDate, $endDate]);
        } elseif ($request->filled('month')) {
            $start = Carbon::createFromFormat('Y-m', $request->input('month'))->startOfMonth();
            $end = (clone $start)->endOfMonth();
            $query->whereBetween('work_date', [$start->toDateString(), $end->toDateString()]);
        }

        $logs = $query->orderBy('work_date', 'desc')->get();
        $rows = $logs->map(fn (HrmsAttendanceLog $log) => $this->formatAttendanceRow($log, $employee))->values()->all();

        return response()->json([
            'hasEmployee' => true,
            'rows' => $rows,
            'total' => count($rows),
            'attendance' => $logs,
            'employee' => $employee,
        ]);
    }

    public function punch(Request $request): JsonResponse
    {
        $user = $request->user();

        if (! $user->company_id) {
            return response()->json(['error' => 'No company linked to your account'], 422);
        }

        $data = $request->validate([
            'action' => ['required', 'string'],
            'kind' => ['nullable', 'in:lunch,tea'],
            'lat' => ['nullable', 'numeric'],
            'lng' => ['nullable', 'numeric'],
            'allow_repunch_out' => ['nullable', 'boolean'],
            'allowRepunchOut' => ['nullable', 'boolean'],
        ]);

        $employee = EmployeeRecordService::forUser($user);
        $today = Carbon::now('Asia/Kolkata')->toDateString();
        $now = Carbon::now('Asia/Kolkata');

        $existing = HrmsAttendanceLog::where('employee_id', $employee->id)
            ->where('work_date', $today)
            ->first();

        $action = $this->resolvePunchAction($data['action'], $data['kind'] ?? null, $existing);

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

            return $this->punchResponse($log, 201);
        }

        if (! $existing) {
            return response()->json(['error' => 'Not checked in today'], 400);
        }

        $update = [];

        switch ($action) {
            case 'check_out':
                $allowRepunch = (bool) ($data['allow_repunch_out'] ?? $data['allowRepunchOut'] ?? false);
                if ($existing->check_out_at && ! $allowRepunch) {
                    return response()->json(['error' => 'Already checked out today'], 409);
                }
                $update['check_out_at'] = $now;
                $update['check_out_lat'] = $data['lat'] ?? null;
                $update['check_out_lng'] = $data['lng'] ?? null;
                $update['lunch_break_started_at'] = null;
                $update['tea_break_started_at'] = null;
                if ($existing->check_in_at) {
                    $checkIn = Carbon::parse($existing->check_in_at);
                    $grossMinutes = max(0, (int) round($checkIn->diffInMinutes($now)));
                    $lunchMinutes = $this->effectiveLunchMinutes($existing, $grossMinutes);
                    $teaMinutes = (int) ($existing->tea_break_minutes ?? 0);
                    $activeMinutes = max(0, $grossMinutes - $lunchMinutes - $teaMinutes);
                    $update['lunch_break_minutes'] = $lunchMinutes;
                    $update['total_hours'] = round($activeMinutes / 60, 2);
                }
                break;
            case 'lunch_out':
                if ($existing->lunch_break_started_at) {
                    return response()->json(['error' => 'Lunch break already started'], 409);
                }
                $update['lunch_check_out_at'] = $now;
                $update['lunch_break_started_at'] = $now;
                break;
            case 'lunch_in':
                if (! $existing->lunch_break_started_at) {
                    return response()->json(['error' => 'No lunch break in progress'], 400);
                }
                $update['lunch_check_in_at'] = $now;
                $update['lunch_break_started_at'] = null;
                if ($existing->lunch_check_out_at) {
                    $mins = (int) round(Carbon::parse($existing->lunch_check_out_at)->diffInMinutes($now));
                    $update['lunch_break_minutes'] = (int) ($existing->lunch_break_minutes ?? 0) + $mins;
                }
                break;
            case 'tea_out':
                if ($existing->tea_break_started_at) {
                    return response()->json(['error' => 'Tea break already started'], 409);
                }
                $update['tea_check_out_at'] = $now;
                $update['tea_break_started_at'] = $now;
                break;
            case 'tea_in':
                if (! $existing->tea_break_started_at) {
                    return response()->json(['error' => 'No tea break in progress'], 400);
                }
                $update['tea_check_in_at'] = $now;
                $update['tea_break_started_at'] = null;
                if ($existing->tea_check_out_at) {
                    $mins = (int) round(Carbon::parse($existing->tea_check_out_at)->diffInMinutes($now));
                    $update['tea_break_minutes'] = (int) ($existing->tea_break_minutes ?? 0) + $mins;
                }
                break;
            default:
                return response()->json(['error' => 'Invalid punch action'], 422);
        }

        try {
            $existing->update($this->filterAttendanceUpdate($update));
        } catch (QueryException $e) {
            report($e);

            return response()->json([
                'error' => 'Could not save punch. Database may need attendance migrations (php artisan migrate).',
            ], 500);
        }
        $existing->refresh();

        return $this->punchResponse($existing);
    }

    /** @param  array<string, mixed>  $update */
    private function filterAttendanceUpdate(array $update): array
    {
        if (self::$attendanceColumns === null) {
            self::$attendanceColumns = array_flip(Schema::getColumnListing('HRMS_attendance_logs'));
        }

        return array_intersect_key($update, self::$attendanceColumns);
    }

    public function company(Request $request): JsonResponse
    {
        $user = $request->user();
        if (! $user->role?->isManagerial()) {
            return response()->json(['error' => 'Forbidden'], 403);
        }

        $query = HrmsAttendanceLog::query()
            ->where('HRMS_attendance_logs.company_id', $user->company_id)
            ->join('HRMS_employees', 'HRMS_attendance_logs.employee_id', '=', 'HRMS_employees.id')
            ->select(
                'HRMS_attendance_logs.*',
                'HRMS_employees.first_name',
                'HRMS_employees.last_name',
                'HRMS_employees.email as employee_email'
            );

        $startDate = $request->input('start_date') ?? $request->input('startDate');
        $endDate = $request->input('end_date') ?? $request->input('endDate');

        if ($startDate && $endDate) {
            $query->whereBetween('HRMS_attendance_logs.work_date', [$startDate, $endDate]);
        } elseif ($request->filled('date')) {
            $query->where('HRMS_attendance_logs.work_date', $request->input('date'));
        } elseif ($request->filled('month')) {
            $start = Carbon::createFromFormat('Y-m', $request->input('month'))->startOfMonth();
            $end = (clone $start)->endOfMonth();
            $query->whereBetween('HRMS_attendance_logs.work_date', [$start->toDateString(), $end->toDateString()]);
        }

        $logs = $query->orderBy('HRMS_attendance_logs.work_date', 'desc')->get();

        $rows = $logs->map(function (HrmsAttendanceLog $log) {
            $employee = new HrmsEmployee;
            $employee->id = $log->employee_id;
            $employee->first_name = $log->getAttribute('first_name');
            $employee->last_name = $log->getAttribute('last_name');
            $employee->email = $log->getAttribute('employee_email');

            return $this->formatAttendanceRow($log, $employee);
        })->values()->all();

        return response()->json([
            'rows' => $rows,
            'total' => count($rows),
            'attendance' => $logs,
        ]);
    }

    private function resolvePunchAction(string $action, ?string $kind, ?HrmsAttendanceLog $existing): string
    {
        $action = strtolower(trim($action));

        if ($action === 'in') {
            return 'check_in';
        }
        if ($action === 'out') {
            return 'check_out';
        }

        if ($action === 'break') {
            $kind = $kind ?? 'lunch';
            if ($kind === 'tea') {
                return $existing?->tea_break_started_at ? 'tea_in' : 'tea_out';
            }

            return $existing?->lunch_break_started_at ? 'lunch_in' : 'lunch_out';
        }

        return $action;
    }

    private function punchResponse(HrmsAttendanceLog $log, int $status = 200): JsonResponse
    {
        $formatted = $this->formatDashboardLog($log);

        return response()->json([
            'log' => $formatted,
            'attendance' => $formatted,
        ], $status);
    }

    /** @return array<string, mixed>|null */
    private function formatDashboardLog(?HrmsAttendanceLog $log): ?array
    {
        if (! $log) {
            return null;
        }

        return [
            'id' => $log->id,
            'work_date' => $log->work_date?->format('Y-m-d'),
            'check_in_at' => $log->check_in_at?->toIso8601String(),
            'check_out_at' => $log->check_out_at?->toIso8601String(),
            'lunch_check_out_at' => $log->lunch_check_out_at?->toIso8601String(),
            'lunch_check_in_at' => $log->lunch_check_in_at?->toIso8601String(),
            'tea_check_out_at' => $log->tea_check_out_at?->toIso8601String(),
            'tea_check_in_at' => $log->tea_check_in_at?->toIso8601String(),
            'lunch_break_started_at' => $log->lunch_break_started_at?->toIso8601String(),
            'tea_break_started_at' => $log->tea_break_started_at?->toIso8601String(),
            'lunch_break_minutes' => (int) ($log->lunch_break_minutes ?? 0),
            'tea_break_minutes' => (int) ($log->tea_break_minutes ?? 0),
            'total_hours' => $log->total_hours !== null ? (float) $log->total_hours : null,
            'status' => $log->status,
        ];
    }

    /** @return array<string, mixed> */
    private function formatAttendanceRow(HrmsAttendanceLog $log, HrmsEmployee $employee): array
    {
        $grossMinutes = null;
        if ($log->check_in_at && $log->check_out_at) {
            $grossMinutes = max(
                0,
                (int) round(Carbon::parse($log->check_in_at)->diffInMinutes(Carbon::parse($log->check_out_at)))
            );
        }

        $lunchRecorded = (int) ($log->lunch_break_minutes ?? 0);
        $effectiveLunch = $grossMinutes !== null
            ? $this->effectiveLunchMinutes($log, $grossMinutes)
            : $lunchRecorded;
        $teaMinutes = (int) ($log->tea_break_minutes ?? 0);
        $activeMinutes = $grossMinutes !== null
            ? max(0, $grossMinutes - $effectiveLunch - $teaMinutes)
            : null;

        $name = trim(($employee->first_name ?? '').' '.($employee->last_name ?? ''));

        return [
            'logId' => $log->id,
            'workDate' => $log->work_date?->format('Y-m-d'),
            'employeeId' => $employee->id,
            'employeeName' => $name !== '' ? $name : null,
            'employeeEmail' => $employee->email ?? '',
            'checkInAt' => $log->check_in_at?->toIso8601String(),
            'lunchCheckOutAt' => $log->lunch_check_out_at?->toIso8601String(),
            'lunchCheckInAt' => $log->lunch_check_in_at?->toIso8601String(),
            'checkOutAt' => $log->check_out_at?->toIso8601String(),
            'totalHours' => $log->total_hours !== null ? (float) $log->total_hours : null,
            'lunchBreakMinutes' => $effectiveLunch,
            'teaBreakMinutes' => $teaMinutes,
            'idleLunchMinutes' => $effectiveLunch,
            'idleTeaMinutes' => $teaMinutes,
            'idleMinutes' => $grossMinutes !== null ? max(0, $effectiveLunch + $teaMinutes) : null,
            'lunchBreakOpen' => (bool) $log->lunch_break_started_at,
            'teaBreakOpen' => (bool) $log->tea_break_started_at,
            'status' => $log->status,
            'grossMinutes' => $grossMinutes,
            'activeMinutes' => $activeMinutes,
            'meetsEightHourWork' => $activeMinutes !== null && $activeMinutes >= 8 * 60,
        ];
    }

    private function effectiveLunchMinutes(HrmsAttendanceLog $log, int $grossMinutes): int
    {
        $recorded = min(24 * 60, max(0, (int) ($log->lunch_break_minutes ?? 0)));
        $noLunchPunch = ! $log->lunch_check_out_at && ! $log->lunch_check_in_at;

        if (
            $noLunchPunch
            && $grossMinutes >= self::MIN_GROSS_FOR_MANDATORY_LUNCH
            && $recorded < self::MANDATORY_LUNCH_MINUTES
        ) {
            $recorded = self::MANDATORY_LUNCH_MINUTES;
        }

        return min($recorded, max(0, $grossMinutes));
    }
}
