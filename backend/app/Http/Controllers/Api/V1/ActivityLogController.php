<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Models\HrmsActivityLog;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\StreamedResponse;

final class ActivityLogController extends Controller
{
    public function index(Request $request): JsonResponse|StreamedResponse
    {
        $filters = $request->validate([
            'search' => ['sometimes', 'string', 'max:160'],
            'action' => ['sometimes', 'string', 'max:100'],
            'category' => ['sometimes', 'in:payroll,security,administration'],
            'outcome' => ['sometimes', 'in:succeeded,failed'],
            'actor' => ['sometimes', 'string', 'max:160'],
            'employee' => ['sometimes', 'string', 'max:160'],
            'from' => ['sometimes', 'date'],
            'to' => ['sometimes', 'date', 'after_or_equal:from'],
            'month' => ['sometimes', 'integer', 'min:1', 'max:12'],
            'year' => ['sometimes', 'integer', 'min:2000', 'max:2100'],
            'page' => ['sometimes', 'integer', 'min:1'],
            'per_page' => ['sometimes', 'integer', 'min:10', 'max:100'],
            'export' => ['sometimes', 'boolean'],
        ]);

        $companyId = (string) $request->user()->company_id;
        $query = $this->filteredQuery($companyId, $filters);
        if ((bool) ($filters['export'] ?? false)) {
            $rows = $query->limit(10000)->get();
            return response()->streamDownload(function () use ($rows): void {
                $out = fopen('php://output', 'wb');
                fputcsv($out, ['Event ID', 'Timestamp', 'Actor', 'Actor Role', 'Action', 'Outcome', 'Employee', 'Payroll Period', 'Run Row ID', 'Field Changed', 'Changed Fields', 'Previous Value', 'New Value', 'Request ID', 'Details']);
                foreach ($rows as $row) {
                    fputcsv($out, [
                        $row->id,
                        $row->created_at?->toIso8601String(),
                        $row->actor?->name ?? $row->actor?->email ?? 'Unknown user',
                        $row->actor_role,
                        $row->action,
                        $row->outcome,
                        $row->targetEmployee?->name ?? $row->targetEmployee?->employee_code,
                        $row->payroll_year && $row->payroll_month ? sprintf('%04d-%02d', $row->payroll_year, $row->payroll_month) : null,
                        $row->monthly_payroll_id,
                        $row->field_changed,
                        json_encode($row->changed_fields),
                        json_encode($row->previous_value),
                        json_encode($row->new_value),
                        $row->request_id,
                        json_encode($row->metadata),
                    ]);
                }
                fclose($out);
            }, 'cirt-activity-log.csv', ['Content-Type' => 'text/csv; charset=UTF-8']);
        }

        $page = (clone $query)->paginate((int) ($filters['per_page'] ?? 25));
        $metrics = HrmsActivityLog::query()->where('company_id', $companyId)
            ->selectRaw('COUNT(*) as total_activities')
            ->selectRaw("SUM(CASE WHEN action LIKE 'payroll.%' OR action = 'payroll_master.changed' THEN 1 ELSE 0 END) as payroll_changes")
            ->selectRaw("SUM(CASE WHEN action LIKE 'auth.%' OR action LIKE 'user.%' OR action = 'user.access.changed' THEN 1 ELSE 0 END) as security_events")
            ->selectRaw("SUM(CASE WHEN outcome = 'failed' THEN 1 ELSE 0 END) as failed_actions")
            ->first();

        return response()->json([
            'events' => collect($page->items())->map(fn (HrmsActivityLog $event) => $this->formatEvent($event))->values(),
            'metrics' => [
                'totalActivities' => (int) ($metrics?->total_activities ?? 0),
                'payrollChanges' => (int) ($metrics?->payroll_changes ?? 0),
                'securityEvents' => (int) ($metrics?->security_events ?? 0),
                'failedActions' => (int) ($metrics?->failed_actions ?? 0),
            ],
            'pagination' => [
                'currentPage' => $page->currentPage(),
                'perPage' => $page->perPage(),
                'total' => $page->total(),
                'lastPage' => $page->lastPage(),
            ],
        ]);
    }

    /** @param array<string,mixed> $filters */
    private function filteredQuery(string $companyId, array $filters): Builder
    {
        return HrmsActivityLog::query()
            ->where('company_id', $companyId)
            ->with(['actor:id,name,email', 'targetEmployee:id,name,email,employee_code'])
            ->when(isset($filters['action']), fn (Builder $q) => $q->where('action', $filters['action']))
            ->when(isset($filters['outcome']), fn (Builder $q) => $q->where('outcome', $filters['outcome']))
            ->when(isset($filters['category']), function (Builder $q) use ($filters): void {
                match ($filters['category']) {
                    'payroll' => $q->where(fn (Builder $sub) => $sub->where('action', 'like', 'payroll.%')->orWhere('action', 'payroll_master.changed')),
                    'security' => $q->where(fn (Builder $sub) => $sub->where('action', 'like', 'auth.%')->orWhere('action', 'like', 'user.%')->orWhere('action', 'user.access.changed')),
                    'administration' => $q->where(fn (Builder $sub) => $sub->where('action', 'like', 'employee.%')->orWhere('action', 'like', 'payroll.configuration.%')),
                };
            })
            ->when(isset($filters['from']), fn (Builder $q) => $q->where('created_at', '>=', $filters['from'].' 00:00:00'))
            ->when(isset($filters['to']), fn (Builder $q) => $q->where('created_at', '<', date('Y-m-d 00:00:00', strtotime($filters['to'].' +1 day'))))
            ->when(isset($filters['month']), fn (Builder $q) => $q->where('payroll_month', $filters['month']))
            ->when(isset($filters['year']), fn (Builder $q) => $q->where('payroll_year', $filters['year']))
            ->when(isset($filters['actor']), function (Builder $q) use ($filters): void {
                $term = mb_strtolower($filters['actor']);
                $q->where(function (Builder $sub) use ($term): void {
                    $sub->where('actor_user_id', $term)->orWhereHas('actor', function (Builder $actor) use ($term): void {
                        $actor->whereRaw('LOWER(name) LIKE ?', ['%'.$term.'%'])
                            ->orWhereRaw('LOWER(email) LIKE ?', ['%'.$term.'%']);
                    });
                });
            })
            ->when(isset($filters['employee']), function (Builder $q) use ($filters): void {
                $term = mb_strtolower($filters['employee']);
                $q->where(function (Builder $sub) use ($term): void {
                    $sub->where('target_employee_user_id', $term)->orWhereHas('targetEmployee', function (Builder $employee) use ($term): void {
                        $employee->whereRaw('LOWER(name) LIKE ?', ['%'.$term.'%'])
                            ->orWhereRaw('LOWER(employee_code) LIKE ?', ['%'.$term.'%']);
                    });
                });
            })
            ->when(isset($filters['search']), function (Builder $q) use ($filters): void {
                $term = mb_strtolower($filters['search']);
                $like = '%'.$term.'%';
                $q->where(function (Builder $sub) use ($like): void {
                    $sub->whereRaw('LOWER(action) LIKE ?', [$like])
                        ->orWhereRaw('LOWER(COALESCE(field_changed, \'\')) LIKE ?', [$like])
                        ->orWhereRaw('LOWER(COALESCE(request_id, \'\')) LIKE ?', [$like])
                        ->orWhereHas('actor', fn (Builder $actor) => $actor->whereRaw('LOWER(name) LIKE ?', [$like]))
                        ->orWhereHas('targetEmployee', fn (Builder $employee) => $employee->whereRaw('LOWER(name) LIKE ?', [$like]));
                });
            })
            ->orderByDesc('created_at')
            ->orderByDesc('id');
    }

    /** @return array<string,mixed> */
    private function formatEvent(HrmsActivityLog $event): array
    {
        return [
            'eventId' => $event->id,
            'timestamp' => $event->created_at?->toIso8601String(),
            'actorUserId' => $event->actor_user_id,
            'actor' => $event->actor?->name ?? $event->actor?->email ?? 'Unknown user',
            'actorRole' => $event->actor_role,
            'action' => $event->action,
            'outcome' => $event->outcome,
            'employeeId' => $event->target_employee_user_id,
            'employee' => $event->targetEmployee?->name ?? $event->targetEmployee?->employee_code,
            'payrollYear' => $event->payroll_year,
            'payrollMonth' => $event->payroll_month,
            'payrollPeriodId' => $event->payroll_period_id,
            'payrollRunId' => $event->monthly_payroll_id,
            'fieldChanged' => $event->field_changed,
            'changeCount' => is_array($event->changed_fields) ? count($event->changed_fields) : ($event->field_changed ? 1 : 0),
            'changedFieldNames' => collect($event->changed_fields ?? [])
                ->map(fn ($change) => is_string($change) ? $change : (is_array($change) ? ($change['field'] ?? null) : null))
                ->filter(fn ($field) => is_string($field) && $field !== '' && ! preg_match('/(^|[.\\/])([^.]*(id|uuid))$/i', $field))
                ->take(8)->values(),
            'changeClassificationSource' => ($event->metadata['changeClassificationSource'] ?? null) === 'payroll-ui' ? 'payroll-ui' : null,
            'directChangeCount' => is_array($event->metadata['directEditedFields'] ?? null) ? count($event->metadata['directEditedFields']) : null,
            'recalculatedChangeCount' => is_array($event->metadata['recalculatedFields'] ?? null) ? count($event->metadata['recalculatedFields']) : null,
        ];
    }

    public function show(Request $request, string $id): JsonResponse
    {
        $event = HrmsActivityLog::query()->where('company_id', (string) $request->user()->company_id)
            ->with(['actor:id,name,email', 'targetEmployee:id,name,email,employee_code'])->findOrFail($id);
        $data = $this->formatEvent($event);
        $data['previousValue'] = $this->redact($event->previous_value);
        $data['newValue'] = $this->redact($event->new_value);
        $data['changedFields'] = $this->redact($event->changed_fields ?? []);
        $data['requestId'] = $event->request_id;
        $data['details'] = $this->redact($event->metadata ?? []);
        $data['createdAt'] = $event->created_at?->toIso8601String();

        return response()->json(['event' => $data]);
    }

    private function redact(mixed $value): mixed
    {
        if (! is_array($value)) return $value;
        $safe = [];
        foreach ($value as $key => $item) {
            if (is_string($key) && preg_match('/password|token|secret|credential|account|ifsc|bank|email|phone/i', $key)) continue;
            $safe[$key] = $this->redact($item);
        }
        return $safe;
    }
}
