<?php

namespace App\Http\Controllers\Api\V1;

use App\Enums\UserRole;
use App\Http\Controllers\Controller;
use App\Services\EmployeePayrollExportService;
use App\Services\PeriodReportService;
use App\Services\PostPayrollDownloadService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/** Month picker list and on-screen preview for the multi-period TDS Data / Export Employee Payroll reports. */
final class PeriodReportController extends Controller
{
    public function __construct(
        private readonly PeriodReportService $periods,
        private readonly PostPayrollDownloadService $tds,
        private readonly EmployeePayrollExportService $employees,
    ) {}

    /** Months with a generated/finalized run (draft-only months are not listed). */
    public function periods(Request $request): JsonResponse
    {
        return response()->json(['periods' => $this->periods->periods((string) $request->user()->company_id)]);
    }

    public function preview(Request $request, string $type): JsonResponse
    {
        abort_unless(in_array($type, ['tds', 'employee-payroll'], true), 404);
        $user = $request->user();
        $role = $user->role instanceof UserRole ? $user->role->value : (string) $user->role;
        abort_if($type === 'employee-payroll' && $role !== UserRole::Admin->value, 403, 'Forbidden');

        $companyId = (string) $user->company_id;
        $months = $this->periods->parseMonths($request->query('months'));
        $periodIds = $this->periods->periodIdsFor($companyId, $months);

        if ($type === 'tds') {
            $rows = $this->tds->rowsForMonths($companyId, $months);
            $extras = $this->periods->customColumns($companyId, array_map(fn ($r) => [$r['custom_earnings'] ?? null, $r['custom_deductions'] ?? null], $rows));
            $table = $this->tds->tdsTable($rows, $extras);
        } else {
            $ids = $request->query('employeeUserIds', '');
            $ids = array_values(array_filter(array_map('trim', is_array($ids) ? $ids : explode(',', (string) $ids))));
            $table = $this->employees->previewTable($companyId, $periodIds, $ids);
        }

        return response()->json([
            'type' => $type,
            'months' => $months,
            'rangeLabel' => PeriodReportService::rangeLabel($months),
            'headers' => $table['headers'],
            'rows' => $table['rows'],
            'totals' => $table['totals'],
            'moneyColumns' => $table['moneyColumns'],
            'rowCount' => count($table['rows']),
        ]);
    }
}
