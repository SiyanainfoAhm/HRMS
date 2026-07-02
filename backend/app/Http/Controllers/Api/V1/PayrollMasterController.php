<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Enums\UserRole;
use App\Models\HrmsPayrollMaster;
use App\Models\HrmsUser;
use App\Services\PayrollCalculationService;
use App\Services\PayrollArrearService;
use App\Services\PayrollMasterService;
use App\Support\SpreadsheetImportSecurity;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;
use Symfony\Component\HttpFoundation\StreamedResponse;

class PayrollMasterController extends Controller
{
    public function __construct(
        private readonly PayrollMasterService $service,
        private readonly PayrollCalculationService $calculator,
        private readonly PayrollArrearService $arrearService,
    ) {}

    private function assertPayrollMasterAdmin(HrmsUser $user): ?JsonResponse
    {
        $role = $user->role;
        $roleKey = $role instanceof UserRole ? $role->value : (is_string($role) ? $role : '');
        if (! in_array($roleKey, [UserRole::Admin->value], true)) {
            return response()->json(['error' => 'Forbidden'], 403);
        }

        return null;
    }

    public function index(Request $request): JsonResponse
    {
        if ($denied = $this->assertPayrollMasterAdmin($request->user())) {
            return $denied;
        }

        $user = $request->user();
        $companyId = $user->company_id;

        if (! $companyId && config('app.debug')) {
            Log::warning('payroll_master.index missing company_id', ['user_id' => $user->id]);
        }

        $rows = $this->service->listForCompany($companyId);

        if (config('app.debug')) {
            Log::debug('payroll_master.index', [
                'user_id' => $user->id,
                'company_id' => $companyId,
                'response_count' => count($rows),
            ]);
        }

        return response()->json(['masters' => $rows, 'employees' => $rows]);
    }

    public function store(Request $request): JsonResponse
    {
        $user = $request->user();
        if ($denied = $this->assertPayrollMasterAdmin($user)) {
            return $denied;
        }

        $master = $this->service->create(
            $request->all(),
            (string) $user->company_id,
            $user->id,
            $request->boolean('autosave') || $request->boolean('autoSave'),
            ! ($request->boolean('autosave') || $request->boolean('autoSave')),
        );

        return response()->json(['master' => $this->service->formatRow($master)], 201);
    }

    public function show(Request $request, string $id): JsonResponse
    {
        $user = $request->user();
        if ($denied = $this->assertPayrollMasterAdmin($user)) {
            return $denied;
        }

        $master = HrmsPayrollMaster::findOrFail($id);
        if ($master->company_id !== $user->company_id) {
            return response()->json(['error' => 'Forbidden'], 403);
        }

        return response()->json(['master' => $this->service->formatRow($master)]);
    }

    public function update(Request $request, string $id): JsonResponse
    {
        $user = $request->user();
        if ($denied = $this->assertPayrollMasterAdmin($user)) {
            return $denied;
        }

        $master = HrmsPayrollMaster::findOrFail($id);
        if (config('app.debug')) {
            Log::debug('payroll_master.http_update', [
                'master_id' => $id,
                'payload_da' => $request->input('da_percent') ?? $request->input('daPercent'),
            ]);
        }
        $master = $this->service->update(
            $master,
            $request->all(),
            (string) $user->company_id,
            $request->boolean('autosave') || $request->boolean('autoSave'),
        );

        return response()->json(['master' => $this->service->formatRow($master)]);
    }

    public function history(Request $request, string $id): JsonResponse
    {
        $user = $request->user();
        if ($denied = $this->assertPayrollMasterAdmin($user)) {
            return $denied;
        }

        $master = HrmsPayrollMaster::findOrFail($id);
        if ($master->company_id !== $user->company_id) {
            return response()->json(['error' => 'Forbidden'], 403);
        }

        $history = $this->service->historyForMaster($master, $user->company_id);

        return response()->json(['history' => $history]);
    }

    public function arrearHistory(Request $request, string $id): JsonResponse
    {
        $user = $request->user();
        if ($denied = $this->assertPayrollMasterAdmin($user)) {
            return $denied;
        }

        $master = HrmsPayrollMaster::findOrFail($id);
        if ($master->company_id !== $user->company_id) {
            return response()->json(['error' => 'Forbidden'], 403);
        }

        $employeeUserId = (string) ($master->employee_user_id ?? $master->user_id ?? '');
        if ($employeeUserId === '') {
            return response()->json(['arrearHistory' => []]);
        }

        return response()->json([
            'arrearHistory' => $this->arrearService->arrearHistoryForEmployee($employeeUserId),
        ]);
    }

    public function recalculate(Request $request, string $id): JsonResponse
    {
        $user = $request->user();
        if ($denied = $this->assertPayrollMasterAdmin($user)) {
            return $denied;
        }

        $master = HrmsPayrollMaster::findOrFail($id);
        if ($master->company_id !== $user->company_id) {
            return response()->json(['error' => 'Forbidden'], 403);
        }

        $master = $this->service->recalculate($master);

        return response()->json(['master' => $this->service->formatRow($master)]);
    }

    public function recalculateAll(Request $request): JsonResponse
    {
        $user = $request->user();
        if ($denied = $this->assertPayrollMasterAdmin($user)) {
            return $denied;
        }

        $count = $this->service->recalculateAll($user->company_id);

        return response()->json(['recalculated' => $count]);
    }

    public function syncExisting(Request $request): JsonResponse
    {
        $user = $request->user();
        if ($denied = $this->assertPayrollMasterAdmin($user)) {
            return $denied;
        }

        $result = $this->service->syncExistingEmployees($user->company_id, $user->id);

        return response()->json($result);
    }

    private function validateImportFile(Request $request): ?JsonResponse
    {
        $request->validate(['file' => ['required', 'file', 'mimes:csv,xlsx,xls', 'max:10240']]);
        $file = $request->file('file');
        if (! $file) {
            return response()->json(['error' => 'File is required'], 422);
        }

        $message = SpreadsheetImportSecurity::validateUploadedFile($file);
        if ($message !== null) {
            return response()->json(['error' => $message], 422);
        }

        return null;
    }

    public function import(Request $request): JsonResponse
    {
        $user = $request->user();
        if ($denied = $this->assertPayrollMasterAdmin($user)) {
            return $denied;
        }

        if ($fileError = $this->validateImportFile($request)) {
            return $fileError;
        }

        $result = $this->service->importFile($request->file('file'), $user->company_id, $user->id);
        $blocked = str_contains((string) ($result['message'] ?? ''), 'Import blocked');

        return response()->json($result, $blocked || ($result['summary']['failed_rows'] ?? 0) > 0 ? 422 : 200);
    }

    public function importPreview(Request $request): JsonResponse
    {
        $user = $request->user();
        if ($denied = $this->assertPayrollMasterAdmin($user)) {
            return $denied;
        }

        if ($fileError = $this->validateImportFile($request)) {
            return $fileError;
        }

        $result = $this->service->previewImportFile($request->file('file'), $user->company_id);

        return response()->json($result);
    }

    public function importTemplate(Request $request): StreamedResponse
    {
        if ($denied = $this->assertPayrollMasterAdmin($request->user())) {
            abort(403);
        }
        $format = $request->query('format') === 'csv' ? 'csv' : 'xlsx';

        return $this->service->templateDownload($format, $request->user()->company_id);
    }

    public function export(Request $request): StreamedResponse
    {
        if ($denied = $this->assertPayrollMasterAdmin($request->user())) {
            abort(403);
        }
        $format = $request->query('format') === 'csv' ? 'csv' : 'xlsx';

        return $this->service->exportSpreadsheet($request->user()->company_id, $format);
    }

    public function deactivate(Request $request, string $id): JsonResponse
    {
        $user = $request->user();
        if ($denied = $this->assertPayrollMasterAdmin($user)) {
            return $denied;
        }

        $master = HrmsPayrollMaster::findOrFail($id);
        if ($master->company_id !== $user->company_id) {
            return response()->json(['error' => 'Forbidden'], 403);
        }

        $master = $this->service->deactivate($master);

        return response()->json(['master' => $this->service->formatRow($master)]);
    }

    public function preview(Request $request): JsonResponse
    {
        if ($denied = $this->assertPayrollMasterAdmin($request->user())) {
            abort(403);
        }

        $calc = $this->calculator->calculateMaster($request->all());

        return response()->json(['preview' => $calc]);
    }
}
