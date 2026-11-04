<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Services\PeriodReportService;
use App\Services\PostPayrollDownloadService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Symfony\Component\HttpFoundation\BinaryFileResponse;

/** CIRT-11/12: Post Payroll Downloads (CPF, Division-Wise, TDS, Paybill) for generated months. */
final class PostPayrollDownloadController extends Controller
{
    public function __construct(private readonly PostPayrollDownloadService $service) {}

    /** Months that have generated payroll (the only months a report can be built for), as "YYYY-MM". */
    public function months(Request $request): JsonResponse
    {
        $months = DB::table('cirt_monthly_payroll')
            ->where('company_id', (string) $request->user()->company_id)
            ->selectRaw("to_char(month_year, 'YYYY-MM') as ym")->distinct()->orderBy('ym')->pluck('ym')->all();

        return response()->json(['months' => $months]);
    }

    /** TDS Data for any set of generated months (employee-grouped, month-ordered, custom columns, totals). */
    private function downloadTdsMonths(Request $request): BinaryFileResponse
    {
        $companyId = (string) $request->user()->company_id;
        $periods = app(PeriodReportService::class);
        $months = $periods->parseMonths($request->query('months'));
        $periods->periodIdsFor($companyId, $months);
        $rows = $this->service->rowsForMonths($companyId, $months);
        abort_if($rows === [], 404, 'No generated payroll was found for the selected months.');
        $extras = $periods->customColumns($companyId, array_map(fn ($r) => [$r['custom_earnings'] ?? null, $r['custom_deductions'] ?? null], $rows));
        $book = $this->service->buildTds($rows, $extras);

        return response()->download($this->service->save($book), 'TDS_DATA_'.PeriodReportService::rangeLabel($months).'.xlsx', [
            'Content-Type' => 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        ])->deleteFileAfterSend(true);
    }

    /** Division-Wise Salary for any set of generated months: employees under each real division, one workbook. */
    private function downloadDivisionMonths(Request $request): BinaryFileResponse
    {
        $companyId = (string) $request->user()->company_id;
        $periods = app(PeriodReportService::class);
        $months = $periods->parseMonths($request->query('months'));
        $periods->periodIdsFor($companyId, $months);
        $rows = $this->service->rowsForMonths($companyId, $months);
        abort_if($rows === [], 404, 'No generated payroll was found for the selected months.');
        $book = $this->service->buildDivisionWise($rows, null, $this->service->settingsDivisionNames($companyId));

        return response()->download($this->service->save($book), 'Division_Wise_'.PeriodReportService::rangeLabel($months).'.xlsx', [
            'Content-Type' => 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        ])->deleteFileAfterSend(true);
    }

    public function download(Request $request, string $type): BinaryFileResponse
    {
        abort_unless(in_array($type, ['cpf', 'division-wise', 'tds', 'paybill'], true), 404);
        if ($type === 'tds' && $request->filled('months')) {
            return $this->downloadTdsMonths($request);
        }
        if ($type === 'division-wise' && $request->filled('months')) {
            return $this->downloadDivisionMonths($request);
        }
        $d = $request->validate([
            'year' => ['required', 'integer', 'min:2000', 'max:2100'],
            'month' => ['required', 'integer', 'min:1', 'max:12'],
            'to_year' => ['sometimes', 'integer', 'min:2000', 'max:2100'],
            'to_month' => ['sometimes', 'integer', 'min:1', 'max:12'],
        ]);
        $from = (int) $d['year'] * 100 + (int) $d['month'];
        $to = $type === 'tds' && isset($d['to_year'], $d['to_month']) ? (int) $d['to_year'] * 100 + (int) $d['to_month'] : $from;
        abort_if($to < $from, 422, 'The end month is before the start month.');
        abort_if($to - $from > 1200, 422, 'Month range is too long.');

        $rows = $this->service->rows((string) $request->user()->company_id, $from, $to);
        abort_if($rows === [], 404, 'No generated payroll was found for the selected month.');

        $book = match ($type) {
            'cpf' => $this->service->buildCpf($rows, $from),
            'division-wise' => $this->service->buildDivisionWise($rows, $from, $this->service->settingsDivisionNames((string) $request->user()->company_id)),
            'tds' => $this->service->buildTds($rows),
            'paybill' => $this->service->buildPaybill($rows, $from),
        };
        $name = match ($type) {
            'cpf' => "CPF_{$from}.xlsx", 'division-wise' => "Division_Wise_{$from}.xlsx",
            'tds' => $from === $to ? "TDS_DATA_{$from}.xlsx" : "TDS_DATA_{$from}_{$to}.xlsx", 'paybill' => "Paybill_{$from}.xlsx",
        };

        return response()->download($this->service->save($book), $name, [
            'Content-Type' => 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        ])->deleteFileAfterSend(true);
    }
}
