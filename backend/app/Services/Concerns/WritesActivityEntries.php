<?php

namespace App\Services\Concerns;

use App\Models\HrmsActivityLogDetail;
use App\Models\HrmsActivityLogEntry;
use App\Models\HrmsMonthlyPayrollAudit;
use App\Models\HrmsUser;
use App\Support\ActivityChangeLabels;
use App\Support\ActivityDiff;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * CIRT-10: ONE main Activity Log record per action and its child "View Details" rows,
 * instead of one cirt_activity_logs row per employee. Used by ActivityLogService.
 */
trait WritesActivityEntries
{
    /** action code => [Action label, Module]. */
    public const ENTRY_ACTIONS = [
        'payroll.draft.saved' => ['Payroll Draft', 'Payroll'],
        'payroll.draft.discarded' => ['Payroll Reset', 'Payroll'],
        'payroll.generated' => ['Payroll Generated', 'Payroll'],
        'payroll.generated.amended' => ['Payroll Amended', 'Payroll'],
        'payslip.generated' => ['Payslips Generated', 'Payroll'],
        'payroll.period.changed' => ['Payroll Period Change', 'Payroll'],
        'payroll_master.changed' => ['Payroll Master Change', 'Master'],
        'payroll_master.bulk' => ['Payroll Master Bulk Update', 'Master'],
        'payroll.quarters.changed' => ['Quarter / Rent Change', 'Master'],
        'payroll.configuration.changed' => ['Earnings and Deductions Configuration Change', 'Configuration'],
        'payroll.rates.changed' => ['Payroll Rates / Tariff Change', 'Configuration'],
        'payroll.excel.exported' => ['Report Downloaded', 'Reports'],
        'payroll.bank_letter.downloaded' => ['Bank Letter Downloaded', 'Reports'],
        'master.increment.applied' => ['Salary Increment Applied', 'Master'],
    ];

    private const MAX_DETAIL_ROWS = 500;

    private function usesEntryModel(string $action): bool
    {
        return isset(self::ENTRY_ACTIONS[$action]);
    }

    /**
     * @param array<string, mixed> $c context built by recordRequest()
     */
    private function writeEntry(array $c): ?HrmsActivityLogEntry
    {
        [$label, $module] = [$c['label'] ?? null, $c['module'] ?? null];
        if ($label === null || $module === null) [$label, $module] = self::ENTRY_ACTIONS[$c['action']];
        $details = array_key_exists('details', $c) ? (array) $c['details'] : ($c['success'] ? $this->entryDetails($c) : []);

        // Autosaves and no-op saves that change nothing relevant are not activity.
        if ($c['success'] && $details === [] && ($c['skipWhenEmpty'] ?? in_array($c['action'], ['payroll.draft.saved', 'payroll_master.changed', 'payroll.configuration.changed', 'payroll.generated.amended'], true))) {
            return null;
        }

        $actor = $c['actor'];
        $employeeCount = in_array($c['action'], ['payroll.draft.saved', 'payroll.draft.discarded', 'payroll.generated', 'payroll.generated.amended', 'payslip.generated'], true)
            ? max(count($c['targets']), (int) ($c['metadata']['employeeCount'] ?? 0), (int) ($c['employeeCount'] ?? 0))
            : (int) ($c['action'] === 'payroll_master.changed' && $c['targets'] !== [] ? count($c['targets']) : 0);

        return DB::transaction(function () use ($c, $label, $module, $details, $actor, $employeeCount): HrmsActivityLogEntry {
            $extra = [];
            if (\Illuminate\Support\Facades\Schema::hasColumn('cirt_activity_log_entries', 'summary')) {
                $extra['summary'] = isset($c['summary']) && $c['summary'] !== [] ? \App\Support\ActivityDiff::scrub($c['summary']) : null;
                $extra['subject'] = isset($c['subject']) ? mb_substr((string) $c['subject'], 0, 200) : null;
            }
            $entry = HrmsActivityLogEntry::query()->create($extra + [
                'company_id' => $c['companyId'],
                'action_code' => $c['action'],
                'action_label' => $label,
                'module' => $module,
                'performed_by_user_id' => $actor?->id,
                'performed_by_name' => $actor?->name ?? $actor?->email ?? 'Unknown user',
                'performed_at' => now(),
                'payroll_year' => $c['year'] > 0 ? $c['year'] : null,
                'payroll_month' => $c['month'] > 0 ? $c['month'] : null,
                'employee_count' => $employeeCount,
                'detail_count' => count($details),
                'outcome' => $c['success'] ? 'succeeded' : 'failed',
                'request_id' => $c['requestId'],
                'metadata' => $c['metadata'] ?: null,
            ]);
            $withDiff = \Illuminate\Support\Facades\Schema::hasColumn('cirt_activity_log_details', 'diff');
            foreach (array_chunk($details, 200) as $chunk) {
                DB::table('cirt_activity_log_details')->insert(array_map(static fn (array $d) => [
                    'id' => (string) Str::uuid(), 'entry_id' => $entry->id,
                    'employee_user_id' => $d['employeeId'], 'employee_label' => $d['employee'],
                    'changed_item' => mb_substr($d['item'], 0, 200),
                    'previous_value' => $d['previous'] === null ? null : mb_substr((string) $d['previous'], 0, 500),
                    'updated_value' => $d['updated'] === null ? null : mb_substr((string) $d['updated'], 0, 500),
                    'sort_order' => $d['order'],
                ] + ($withDiff ? [
                    'diff' => isset($d['diff']) ? json_encode($d['diff'], JSON_UNESCAPED_UNICODE) : null,
                    'change_kind' => $d['kind'] ?? 'typed',
                ] : []), $chunk));
            }

            return $entry;
        });
    }

    /**
     * @param array<string, mixed> $c
     * @return list<array{employeeId: ?string, employee: ?string, item: string, previous: ?string, updated: ?string, order: int}>
     */
    private function entryDetails(array $c): array
    {
        $details = [];
        $names = $this->entryEmployeeLabels($c['targets']);
        $add = function (?string $employeeId, string $item, mixed $previous, mixed $updated) use (&$details, $names): void {
            if (count($details) >= self::MAX_DETAIL_ROWS) return;
            $details[] = [
                'employeeId' => $employeeId, 'employee' => $employeeId ? ($names[$employeeId] ?? null) : null, 'item' => $item,
                'previous' => ActivityChangeLabels::display($previous), 'updated' => ActivityChangeLabels::display($updated),
                'order' => count($details),
            ];
        };
        $addChange = function (?string $employeeId, string $item, mixed $previous, mixed $updated, string $type, string $kind, string $field) use (&$details, $names): void {
            if (count($details) >= self::MAX_DETAIL_ROWS) return;
            $empty = fn ($v) => $v === null || $v === '';
            $details[] = [
                'employeeId' => $employeeId, 'employee' => $employeeId ? ($names[$employeeId] ?? null) : null, 'item' => $item,
                'previous' => $empty($previous) ? null : ActivityDiff::format($previous, $type), 'updated' => $empty($updated) ? null : ActivityDiff::format($updated, $type),
                'order' => count($details), 'kind' => $kind,
                'diff' => ['field' => $field, 'old' => $previous, 'new' => $updated, 'type' => $type],
            ];
        };
        $rows = is_array($c['rows']) ? $c['rows'] : [];

        switch ($c['action']) {
            case 'payroll.draft.saved':
                foreach ($c['targets'] as $targetId) {
                    $row = collect($rows)->first(fn ($r) => is_array($r) && (string) ($r['employeeUserId'] ?? $r['employee_user_id'] ?? '') === $targetId);
                    if (! is_array($row)) continue;
                    [$fields, $previous, $updated] = $this->changedPayloadValues(($c['draftBefore'] ?? [])[$targetId] ?? [], $this->draftRowValues($row));
                    // The operator's own edits come with the row ("changedFields"); anything else that moved is a recalculation.
                    $tokens = $row['changedFields'] ?? $row['changed_fields'] ?? null;
                    $typed = is_array($tokens) && $tokens !== []
                        ? array_flip(array_map(fn ($t) => lcfirst((string) preg_replace('/^gov(?:Earning|Deduction|CustomDeduction|Custom)_/', '', (string) $t)), $tokens))
                        : null;
                    $totalLines = [];
                    $startCount = count($details);
                    foreach ($fields as $field) {
                        $last = str_contains($field, '.') ? substr($field, (int) strrpos($field, '.') + 1) : $field;
                        $old = $previous[$field] ?? null;
                        $new = $updated[$field] ?? null;
                        if (ActivityChangeLabels::isRelevant($field)) {
                            $isTyped = $typed === null || isset($typed[$last]) || isset($typed[lcfirst(str_replace('_', '', ucwords($last, '_')))]);
                            $addChange($targetId, ActivityChangeLabels::label($field).($isTyped ? '' : ' (recalculated)'), $old, $new, ActivityDiff::type($last, $new ?? $old), $isTyped ? 'typed' : 'recalculated', $field);
                        } elseif (in_array($field, ['totalEarnings', 'totalDeductions', 'netPay'], true)) {
                            $totalLines[$field] = [$old, $new];
                        }
                    }
                    // Derived totals: one compact line, only when something else changed (never a full dump).
                    if ($totalLines !== [] && count($details) > $startCount) {
                        $labels = ['totalEarnings' => 'Gross', 'totalDeductions' => 'Deductions', 'netPay' => 'Net pay'];
                        $prev = $new = [];
                        foreach ($totalLines as $f => [$o, $n]) {
                            $prev[] = $labels[$f].' '.ActivityDiff::format($o, 'money');
                            $new[] = $labels[$f].' '.ActivityDiff::format($n, 'money');
                        }
                        if (count($details) < self::MAX_DETAIL_ROWS) {
                            $details[] = [
                                'employeeId' => $targetId, 'employee' => $names[$targetId] ?? null, 'item' => 'Totals recalculated',
                                'previous' => implode(' · ', $prev), 'updated' => implode(' · ', $new), 'order' => count($details), 'kind' => 'recalculated',
                                'diff' => ['field' => 'totals', 'old' => array_map(fn ($v) => $v[0], $totalLines), 'new' => array_map(fn ($v) => $v[1], $totalLines), 'type' => 'money'],
                            ];
                        }
                    }
                }
                break;

            case 'payroll.draft.discarded':
                $count = is_array($c['draftBefore']) ? count($c['draftBefore']) : 0;
                $add(null, sprintf('Draft %02d/%04d', $c['month'], $c['year']), $count > 0 ? "Saved draft ({$count} employee rows)" : 'No saved draft', 'Reset to Master values');
                break;

            case 'payroll.generated.amended':
                foreach ($c['targets'] as $targetId) {
                    $monthlyId = $c['monthly']?->id;
                    $audit = HrmsMonthlyPayrollAudit::query()
                        ->when($monthlyId, fn ($q) => $q->where('monthly_payroll_id', $monthlyId))
                        ->when(! $monthlyId && $c['periodId'], fn ($q) => $q->whereIn('monthly_payroll_id', fn ($s) => $s->select('id')->from('cirt_monthly_payroll')->where('payroll_period_id', $c['periodId'])->where('employee_user_id', $targetId)))
                        ->latest('created_at')->first();
                    foreach ((array) ($audit?->changed_fields ?? []) as $change) {
                        if (! is_array($change) || ! isset($change['field']) || ! ActivityChangeLabels::isRelevant((string) $change['field'])) continue;
                        $add($targetId, ActivityChangeLabels::label((string) $change['field']), $change['before'] ?? null, $change['after'] ?? null);
                    }
                }
                break;

            case 'payroll.configuration.changed':
            case 'payroll_master.changed':
                $before = (array) ($c['before'] ?? []);
                $after = (array) ($c['after'] ?? []);
                $employeeId = is_string($before['__employee'] ?? $after['__employee'] ?? null) ? ($before['__employee'] ?? $after['__employee']) : null;
                $context = (string) ($after['field_label'] ?? $before['field_label'] ?? '');
                // Status, role and reference changes (quarter, division...) are real changes even though other ids are not.
                $always = ['status', 'quarter_id', 'division_id', 'department_id', 'designation_id', 'role_id', 'employment_status', 'is_active'];
                foreach (array_unique([...array_keys($before), ...array_keys($after)]) as $key) {
                    if (! is_string($key) || str_starts_with($key, '__') || ActivityDiff::isSecretKey($key)) continue;
                    if (! in_array($key, $always, true) && ! ActivityChangeLabels::isRelevant($key)) continue;
                    foreach (ActivityDiff::diff([$key => $before[$key] ?? null], [$key => $after[$key] ?? null], ['resolve' => true]) as $ch) {
                        $item = in_array($key, $always, true) && ! in_array($key, ['status'], true) ? ActivityDiff::label($key) : ActivityChangeLabels::label($key);
                        $addChange($employeeId, $c['action'] === 'payroll.configuration.changed' && $context !== '' && $key !== 'field_label' ? "{$context}: {$item}" : $item, $ch['old'], $ch['new'], $ch['type'], 'typed', $key);
                    }
                }
                break;

            default: // bulk / rates / quarters / periods / generate: the request inputs that matter
                $flat = [];
                $walk = function (array $values, string $prefix = '') use (&$walk, &$flat): void {
                    foreach ($values as $key => $value) {
                        if (! is_string($key)) continue;
                        $path = $prefix === '' ? $key : $prefix.'.'.$key;
                        if (is_array($value)) { $walk($value, $path); continue; }
                        if (is_scalar($value) && ActivityChangeLabels::isRelevant($path)) $flat[$path] = $value;
                    }
                };
                $walk((array) $c['safeInput']);
                foreach ($flat as $path => $value) $add(null, ActivityChangeLabels::label($path), null, $value);
                if ($c['action'] === 'payroll.generated' && $c['targets'] !== []) {
                    $add(null, sprintf('Payroll %02d/%04d', $c['month'], $c['year']), null, 'Generated for '.count($c['targets']).' employees');
                }
        }

        return $details;
    }

    /** @param list<string> $ids @return array<string, string> */
    private function entryEmployeeLabels(array $ids): array
    {
        if ($ids === []) return [];
        $out = [];
        foreach (HrmsUser::query()->whereIn('id', array_slice($ids, 0, 500))->get(['id', 'name', 'employee_code']) as $u) {
            $out[(string) $u->id] = trim(($u->name ?? '').($u->employee_code ? " ({$u->employee_code})" : ''));
        }

        return $out;
    }

    /** Scalar columns of an employee's current Payroll Master, for before/after comparison. @return array<string, mixed>|null */
    private function currentMasterValues(string $companyId, ?string $employeeUserId): ?array
    {
        if (! $employeeUserId) return null;
        $row = DB::table('cirt_payroll_master')->where('company_id', $companyId)->where('employee_user_id', $employeeUserId)
            ->whereNull('effective_to')->orderByDesc('effective_from')->first();
        if (! $row) return null;
        $out = ['__employee' => $employeeUserId];
        foreach ((array) $row as $key => $value) {
            if (is_scalar($value) || $value === null) $out[$key] = $value;
        }

        return $out;
    }
}
