<?php

namespace App\Services\Concerns;

use App\Models\HrmsUser;
use App\Support\ActivityAudit;
use App\Support\ActivityDiff;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Symfony\Component\HttpFoundation\Response;

/**
 * One Activity Log record per audited action, with a details view that lists only what changed (old -> new, plain
 * labels). The table-driven specs live in App\Support\ActivityAudit; the diff and its formatting in ActivityDiff.
 */
trait AuditsRequests
{
    /** Count keys a bulk endpoint may report => the plain label shown in View Details. */
    private const BULK_COUNT_LABELS = [
        'total_rows' => 'Rows in file', 'inserted_rows' => 'Created', 'updated_rows' => 'Updated', 'skipped_rows' => 'Skipped', 'failed_rows' => 'Failed',
        'created' => 'Created', 'updated' => 'Updated', 'revised' => 'Revised', 'skipped' => 'Skipped', 'errors' => 'Errors', 'failed' => 'Failed',
        'imported' => 'Imported', 'synced' => 'Synced', 'recalculated' => 'Recalculated', 'applied' => 'Applied', 'processed' => 'Processed',
        'employeeCount' => 'Employees', 'employee_count' => 'Employees', 'count' => 'Count', 'total' => 'Total',
    ];

    /** Previews and other read-only POSTs are never activity. */
    private function isPreviewRequest(Request $request): bool
    {
        $action = (string) $request->input('action', '');
        if ($action !== '' && str_starts_with($action, 'preview')) return true;

        return (bool) preg_match('~/(?:preview|import-preview)$~', $request->path());
    }

    /** @param array{spec: string, id: ?string, verb: string} $match @return array{spec: string, id: ?string, verb: string} */
    private function resolveAuditMatch(array $match): array
    {
        if ($match['spec'] === 'employee' && $match['id'] !== null) {
            $match['id'] = DB::table('cirt_employees')->where('id', $match['id'])->value('user_id') ?? $match['id'];
        }

        return $match;
    }

    /** State of the audited record BEFORE the request runs. @return array<string, mixed>|null */
    public function captureAuditBefore(Request $request): ?array
    {
        $companyId = $request->user()?->company_id;
        if (! is_string($companyId) || $companyId === '') return null;
        $match = ActivityAudit::match($request->method(), $request->path());
        if ($match === null || $this->isPreviewRequest($request)) return null;
        $match = $this->resolveAuditMatch($match);
        $ctx = ['match' => $match, 'row' => ActivityAudit::snapshot($match, $companyId), 'startedAt' => now()->subSeconds(3)->toDateTimeString()];
        if ($match['spec'] === 'quarter' && in_array($match['verb'], ['assigned', 'released'], true)) {
            $emp = $request->input('employee_user_id') ?? $request->input('employeeUserId');
            $ctx['employeeId'] = $match['verb'] === 'assigned' ? $emp : ($ctx['row']['assigned_employee_id'] ?? null);
            $prev = is_string($emp) && $emp !== ''
                ? DB::table('cirt_quarters')->where('company_id', $companyId)->where('assigned_employee_id', $emp)->first(['quarter_name', 'quarter_type'])
                : null;
            $ctx['previousQuarter'] = $prev ? trim($prev->quarter_name.($prev->quarter_type ? ' ('.$prev->quarter_type.')' : '')) : null;
        }

        return $ctx;
    }

    /** @param array<string, mixed> $ctx */
    private function recordAudited(Request $request, Response $response, array $ctx): void
    {
        $user = $request->user();
        if (! $user || ! is_string($user->company_id)) return;
        $companyId = (string) $user->company_id;
        $match = $ctx['match'];
        $spec = ActivityAudit::SPECS[$match['spec']];
        $verb = $match['verb'];
        $status = $response->getStatusCode();
        $data = json_decode($response->getContent() ?: '', true);
        $success = $status < 400;
        if (! $success && $verb !== 'deleted') return; // a rejected edit changed nothing
        $before = $ctx['row'] ?? null;
        $opts = [
            'labels' => $spec['labels'] ?? [], 'types' => $spec['types'] ?? [], 'ignore' => $spec['ignore'] ?? [],
            'only' => $spec['only'] ?? null,
        ];
        if ($opts['only'] === null) unset($opts['only']);

        $after = null;
        if ($success && $verb !== 'deleted') {
            $afterMatch = $match;
            if ($verb === 'created') $afterMatch['id'] = $this->createdIdFrom($data) ?? $match['id'];
            $after = ActivityAudit::snapshot($afterMatch, $companyId, $verb === 'created' && $afterMatch['id'] === null ? $ctx['startedAt'] : null);
            if ($after === null && $verb === 'created') return;
        }
        $name = ActivityAudit::recordName($match, $after ?? $before);
        $employeeId = null;
        $employeeLabel = null;
        $changes = [];

        if (! $success) { // delete refused
            $reason = is_array($data) ? (string) ($data['error'] ?? $data['message'] ?? 'Not allowed') : 'Not allowed';
            $changes = [$this->change('delete_refused', 'Delete refused: '.$name, $spec['entity'].' kept', mb_substr($reason, 0, 250), 'text')];
            $label = $spec['entity'].' Delete Refused';
        } elseif ($verb === 'created') {
            $changes = $this->createdChanges($after ?? [], $spec, $opts);
            $label = $spec['entity'].' Created';
        } elseif ($verb === 'deleted') {
            $changes = [$this->change('deleted', $spec['entity'].' deleted', $name, null, 'text')];
            $label = $spec['entity'].' Deleted';
        } elseif (in_array($verb, ['assigned', 'released'], true)) {
            [$changes, $employeeId] = $this->quarterAssignmentChanges($ctx, $before, $after, $verb, $request);
            $label = $verb === 'assigned' ? 'Quarter Assigned' : 'Quarter Released';
        } else {
            $changes = ActivityDiff::diff($before ?? [], $after ?? [], $opts);
            $label = $spec['entity'].' '.ucfirst($verb === 'updated' ? 'Updated' : $verb);
            $effective = ActivityAudit::effectiveDate($request, $spec);
            $daChanged = false;
            foreach ($changes as $c) if (in_array($c['key'], ['default_da_percent', 'default_hra_percent'], true)) $daChanged = true;
            if ($changes !== [] && ($effective !== null || $daChanged) && ! empty($spec['effectiveInput'])) {
                $changes[] = $this->change('effective_from', 'Effective from', null, $effective ?? date('Y-m-d'), 'date');
            }
        }
        if ($changes === []) return; // nothing changed: no entry

        if (! empty($spec['employee'])) {
            $employeeId = (string) (($after ?? $before)['id'] ?? $match['id'] ?? '');
            $employeeLabel = null;
        }
        $details = $this->changesToDetails($changes, $employeeId ?: null, $employeeLabel);
        $this->writeEntry([
            'action' => $match['spec'].'.'.$verb, 'label' => $label, 'module' => $spec['module'], 'success' => $success,
            'companyId' => $companyId, 'actor' => $user, 'year' => 0, 'month' => 0, 'periodId' => null, 'monthly' => null,
            'targets' => $employeeId ? [$employeeId] : [], 'rows' => [], 'safeInput' => [], 'before' => null, 'after' => null, 'draftBefore' => null,
            'requestId' => (string) ($request->header('X-Request-ID') ?: \Illuminate\Support\Str::uuid()),
            'metadata' => ['changedFieldCount' => count($changes)], 'details' => $details, 'subject' => $name,
            'summary' => ['record' => $name, 'verb' => $verb], 'employeeCount' => $employeeId ? 1 : 0, 'skipWhenEmpty' => true,
        ]);
    }

    /** @return array{key: string, label: string, old: mixed, new: mixed, type: string, kind: string} */
    private function change(string $key, string $label, mixed $old, mixed $new, string $type = 'text', string $kind = 'typed'): array
    {
        return ['key' => $key, 'label' => $label, 'old' => $old, 'new' => $new, 'type' => $type, 'kind' => $kind];
    }

    /** A new record: its key properties (flags included), each from nothing to its value. @return list<array<string, mixed>> */
    private function createdChanges(array $row, array $spec, array $opts): array
    {
        $keys = $spec['createShow'] ?? $spec['only'] ?? array_keys($row);
        $out = [];
        foreach ($keys as $key) {
            if (in_array($key, $spec['ignore'] ?? [], true) || ActivityDiff::isSecretKey($key)) continue;
            if (! array_key_exists($key, $row) || $row[$key] === null || $row[$key] === '') continue;
            if (preg_match('/(^|_)(id|created_at|updated_at|created_by|updated_by|company_id|normalized_name|sort_order)$/', $key) && ! isset(ActivityDiff::REFERENCES[$key])) continue;
            $value = isset(ActivityDiff::REFERENCES[$key]) ? ActivityDiff::reference($key, $row[$key]) : $row[$key];
            $type = ($opts['types'] ?? [])[$key] ?? (isset(ActivityDiff::REFERENCES[$key]) ? 'text' : ActivityDiff::type($key, $value));
            $out[] = $this->change($key, ($opts['labels'] ?? [])[$key] ?? ActivityDiff::label($key), null, $value, $type);
        }

        return $out;
    }

    /** @return array{0: list<array<string, mixed>>, 1: ?string} */
    private function quarterAssignmentChanges(array $ctx, ?array $before, ?array $after, string $verb, Request $request): array
    {
        $quarter = ($after ?? $before) ?? [];
        $name = trim((string) ($quarter['quarter_name'] ?? '').' '.($quarter['quarter_type'] ?? '' ? '('.$quarter['quarter_type'].')' : ''));
        $rent = $quarter['monthly_rent'] ?? null;
        $employeeId = isset($ctx['employeeId']) && is_string($ctx['employeeId']) ? $ctx['employeeId'] : null;
        $today = date('Y-m-d');
        if ($verb === 'assigned') {
            $changes = [$this->change('quarter', 'Quarter', $ctx['previousQuarter'] ?? null, $name, 'text')];
            if ($rent !== null) $changes[] = $this->change('monthly_rent', 'Monthly rent', null, $rent, 'money');
            $changes[] = $this->change('assigned_from', 'Assigned from', null, ($after['assigned_from'] ?? null) ?: $today, 'date');
        } else {
            $changes = [$this->change('quarter', 'Quarter', $name, 'Released', 'text')];
            if ($rent !== null) $changes[] = $this->change('monthly_rent', 'Monthly rent', $rent, null, 'money');
            $changes[] = $this->change('assigned_to', 'Assigned until', null, $today, 'date');
        }

        return [$changes, $employeeId];
    }

    private function createdIdFrom(mixed $data): ?string
    {
        $find = function (mixed $node, int $depth) use (&$find): ?string {
            if (! is_array($node) || $depth > 2) return null;
            if (isset($node['id']) && is_string($node['id']) && preg_match('/^[0-9a-f-]{36}$/i', $node['id'])) return $node['id'];
            foreach ($node as $child) {
                if (is_array($child) && ($id = $find($child, $depth + 1)) !== null) return $id;
            }

            return null;
        };

        return $find($data, 0);
    }

    /**
     * Changes -> detail rows (Changed Item | Previous | Updated) plus the compact JSON diff stored with each row.
     *
     * @param list<array<string, mixed>> $changes
     * @return list<array<string, mixed>>
     */
    private function changesToDetails(array $changes, ?string $employeeId, ?string $employeeLabel = null, int $startOrder = 0): array
    {
        $names = $employeeId ? $this->entryEmployeeLabels([$employeeId]) : [];
        $label = $employeeLabel ?? ($employeeId ? ($names[$employeeId] ?? null) : null);
        $rows = [];
        foreach ($changes as $c) {
            if (count($rows) >= self::MAX_DETAIL_ROWS) break;
            $isEmpty = fn ($v) => $v === null || $v === '';
            $rows[] = [
                'employeeId' => $employeeId, 'employee' => $label, 'item' => (string) $c['label'],
                'previous' => $isEmpty($c['old']) ? null : ActivityDiff::format($c['old'], (string) $c['type']),
                'updated' => $isEmpty($c['new']) ? null : ActivityDiff::format($c['new'], (string) $c['type']),
                'order' => $startOrder + count($rows), 'kind' => (string) ($c['kind'] ?? 'typed'),
                'diff' => ['field' => $c['key'], 'old' => $c['old'], 'new' => $c['new'], 'type' => $c['type']],
            ];
        }

        return $rows;
    }

    /** Counts a bulk endpoint reports (created / updated / skipped / errors ...), for "summary plus counts". @return array<string, int> */
    private function responseCounts(mixed $data): array
    {
        if (! is_array($data)) return [];
        $counts = [];
        $scan = function (array $node, int $depth) use (&$scan, &$counts): void {
            foreach ($node as $key => $value) {
                if (! is_string($key)) continue;
                if (is_array($value) && $depth < 1 && ! array_is_list($value)) {
                    $scan($value, $depth + 1);
                } elseif (isset(self::BULK_COUNT_LABELS[$key])) {
                    $n = is_array($value) ? count($value) : (is_numeric($value) ? (int) $value : null);
                    if ($n !== null) $counts[$key] = $n;
                }
            }
        };
        $scan($data, 0);

        return $counts;
    }

    /** Bulk actions: a summary plus counts, never every field of every row. */
    private function bulkChanges(Request $request, mixed $data): array
    {
        $changes = [];
        foreach ($this->responseCounts($data) as $key => $n) {
            $changes[] = $this->change($key, self::BULK_COUNT_LABELS[$key] ?? ucfirst($key), null, $n, 'text');
        }
        $effective = $request->input('effective_from') ?? $request->input('effectiveFrom');
        if (is_string($effective) && $effective !== '') $changes[] = $this->change('effective_from', 'Effective from', null, $effective, 'date');
        $file = $request->file('file');
        if ($file) $changes[] = $this->change('file', 'File', null, mb_substr((string) $file->getClientOriginalName(), 0, 120), 'text');

        return $changes;
    }

    /** Who downloaded which report for which periods (no file content). @return list<array<string, mixed>> */
    private function reportChanges(Request $request): array
    {
        $route = $request->path();
        $report = match (true) {
            str_contains($route, 'post-downloads/tds') => 'TDS Data',
            str_contains($route, 'post-downloads/cpf') => 'CPF / VPF Statement',
            str_contains($route, 'post-downloads/division-wise') => 'Division-Wise Salary',
            str_contains($route, 'post-downloads/paybill') => 'Paybill',
            str_ends_with($route, 'master/export-employee-payroll') => 'Employee Payroll Export',
            str_ends_with($route, 'master/export') => 'Payroll Master Export',
            str_ends_with($route, 'payroll/bank-letter') => 'Bank Letter',
            default => 'Payroll Export',
        };
        $months = $request->input('months');
        if (is_array($months)) $months = implode(', ', $months);
        $period = is_string($months) && $months !== ''
            ? $months
            : ($request->input('year') && $request->input('month') ? sprintf('%02d/%04d', (int) $request->input('month'), (int) $request->input('year')) : null);
        $changes = [$this->change('report', 'Report', null, $report, 'text')];
        if ($period) $changes[] = $this->change('periods', 'Period(s)', null, $period, 'text');
        $format = $request->input('format');
        if (is_string($format) && $format !== '') $changes[] = $this->change('format', 'Format', null, strtoupper($format), 'text');

        return $changes;
    }
}
