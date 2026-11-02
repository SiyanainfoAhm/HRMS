<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Services\PostPayrollDownloadService;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\BinaryFileResponse;

/** CIRT-11/12: Post Payroll Downloads (CPF, Division-Wise, TDS, Paybill) for generated months. */
final class PostPayrollDownloadController extends Controller
{
    public function __construct(private readonly PostPayrollDownloadService $service) {}

    public function download(Request $request, string $type): BinaryFileResponse
    {
        abort_unless(in_array($type, ['cpf', 'division-wise', 'tds', 'paybill'], true), 404);
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
            'division-wise' => $this->service->buildDivisionWise($rows, $from),
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
