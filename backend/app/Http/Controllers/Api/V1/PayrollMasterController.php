<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Enums\UserRole;
use App\Models\HrmsPayrollMaster;
use App\Models\HrmsUser;
use App\Services\PayrollCalculationService;
use App\Services\PayrollArrearService;
use App\Services\PayrollMasterService;
use App\Services\EmployeePayrollExportService;
use App\Support\SpreadsheetImportSecurity;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;
use InvalidArgumentException;
use Symfony\Component\HttpFoundation\StreamedResponse;

class PayrollMasterController extends Controller
{
    public function __construct(
        private readonly PayrollMasterService $service,
        private readonly PayrollCalculationService $calculator,
        private readonly PayrollArrearService $arrearService,
        private readonly EmployeePayrollExportService $employeePayrollExport,
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

        $useAll = $request->boolean('all');
        if ($useAll) {
            $rows = $this->service->listForCompany($companyId);
            $total = count($rows);
            $meta = \App\Support\ApiPagination::meta($total, 1, max(1, $total));

            return response()->json([
                'data' => $rows,
                'meta' => $meta,
                'masters' => $rows,
                'employees' => $rows,
            ]);
        }

        $paginated = $this->service->paginatedListForCompany($companyId, $request->query());

        if (config('app.debug')) {
            Log::debug('payroll_master.index', [
                'user_id' => $user->id,
                'company_id' => $companyId,
                'response_count' => count($paginated['data']),
                'meta' => $paginated['meta'],
            ]);
        }

        return response()->json([
            'data' => $paginated['data'],
            'meta' => $paginated['meta'],
            'masters' => $paginated['data'],
            'employees' => $paginated['data'],
        ]);
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

    public function resolveEmployeeCodeConflict(Request $request): JsonResponse
    {
        $user = $request->user();
        if ($denied = $this->assertPayrollMasterAdmin($user)) {
            return $denied;
        }

        $data = $request->validate([
            'current' => ['required', 'array'],
            // apiProxy converts camelCase → snake_case; accept both for safety.
            'current.employee_code' => ['required_without:current.employeeCode', 'nullable', 'string', 'max:64'],
            'current.employeeCode' => ['required_without:current.employee_code', 'nullable', 'string', 'max:64'],
            'current.master_id' => ['nullable', 'uuid'],
            'current.masterId' => ['nullable', 'uuid'],
            'current.user_id' => ['nullable', 'uuid'],
            'current.userId' => ['nullable', 'uuid'],
            'other' => ['required', 'array'],
            'other.employee_code' => ['required_without:other.employeeCode', 'nullable', 'string', 'max:64'],
            'other.employeeCode' => ['required_without:other.employee_code', 'nullable', 'string', 'max:64'],
            'other.master_id' => ['nullable', 'uuid'],
            'other.masterId' => ['nullable', 'uuid'],
            'other.user_id' => ['nullable', 'uuid'],
            'other.userId' => ['nullable', 'uuid'],
        ]);

        $current = $data['current'];
        $other = $data['other'];
        $currentCode = trim((string) ($current['employee_code'] ?? $current['employeeCode'] ?? ''));
        $otherCode = trim((string) ($other['employee_code'] ?? $other['employeeCode'] ?? ''));
        if ($currentCode === '' || $otherCode === '') {
            $errors = [];
            if ($currentCode === '') {
                $errors['current.employee_code'] = ['The current employee code is required.'];
            }
            if ($otherCode === '') {
                $errors['other.employee_code'] = ['The other employee code is required.'];
            }

            return response()->json([
                'error' => 'Both employee codes are required.',
                'message' => 'Both employee codes are required.',
                'errors' => $errors,
            ], 422);
        }

        try {
            $resolved = $this->service->resolveEmployeeCodeConflict(
                (string) $user->company_id,
                $current,
                $other,
            );
        } catch (InvalidArgumentException $e) {
            return response()->json([
                'error' => $e->getMessage(),
                'message' => $e->getMessage(),
            ], 422);
        }

        return response()->json([
            'message' => 'Employee codes updated.',
            'resolved' => $resolved,
        ]);
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

    public function exportEmployeePayroll(Request $request): StreamedResponse|JsonResponse
    {
        $user = $request->user();
        if ($denied = $this->assertPayrollMasterAdmin($user)) {
            return $denied;
        }

        $periodIds = $request->input('period_ids', $request->input('periodIds', []));
        $quarterIds = $request->input('quarter_ids', $request->input('quarterIds', []));
        $employeeUserIds = $request->input('employee_user_ids', $request->input('employeeUserIds', []));
        if (! is_array($periodIds)) {
            $periodIds = array_filter(array_map('trim', explode(',', (string) $periodIds)));
        }
        if (! is_array($quarterIds)) {
            $quarterIds = array_filter(array_map('trim', explode(',', (string) $quarterIds)));
        }
        if (! is_array($employeeUserIds)) {
            $employeeUserIds = array_filter(array_map('trim', explode(',', (string) $employeeUserIds)));
        }

        return $this->employeePayrollExport->export(
            (string) $user->company_id,
            array_values($periodIds),
            array_values($quarterIds),
            array_values(array_map('strval', $employeeUserIds)),
        );
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

        $companyId = (string) ($request->user()->company_id ?? '');
        $transportConfig = null;
        if ($companyId !== '') {
            $company = \App\Models\HrmsCompany::find($companyId);
            if ($company) {
                $transportConfig = PayrollCalculationService::normalizeTransportConfig([
                    'transport_allowance_level_9_plus' => $company->transport_allowance_level_9_plus,
                    'transport_allowance_level_3_8' => $company->transport_allowance_level_3_8,
                    'transport_allowance_level_1_2' => $company->transport_allowance_level_1_2,
                    'transport_allowance_level_1_2_enhanced' => $company->transport_allowance_level_1_2_enhanced,
                    'transport_allowance_basic_threshold' => $company->transport_allowance_basic_threshold,
                    'transport_allowance_high_min_level' => $company->transport_allowance_high_min_level,
                    'transport_allowance_mid_min_level' => $company->transport_allowance_mid_min_level,
                ]);
            }
        }

        $calc = $this->calculator->calculateMaster(
            $request->all(),
            null,
            null,
            null,
            null,
            null,
            $transportConfig,
        );

        return response()->json(['preview' => $calc]);
    }
}
