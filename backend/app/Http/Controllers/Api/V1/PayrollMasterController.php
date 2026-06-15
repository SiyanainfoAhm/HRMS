<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Enums\UserRole;
use App\Models\HrmsPayrollMaster;
use App\Models\HrmsUser;
use App\Services\PayrollCalculationService;
use App\Services\PayrollMasterService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\StreamedResponse;

class PayrollMasterController extends Controller
{
    public function __construct(
        private readonly PayrollMasterService $service,
        private readonly PayrollCalculationService $calculator,
    ) {}

    private function assertPayrollMasterAdmin(HrmsUser $user): ?JsonResponse
    {
        $role = $user->role;
        $roleKey = $role instanceof UserRole ? $role->value : (is_string($role) ? $role : '');
        if (! in_array($roleKey, [UserRole::SuperAdmin->value, UserRole::Admin->value], true)) {
            return response()->json(['error' => 'Forbidden'], 403);
        }

        return null;
    }

    public function index(Request $request): JsonResponse
    {
        if ($denied = $this->assertPayrollMasterAdmin($request->user())) {
            return $denied;
        }

        $rows = $this->service->listForCompany($request->user()->company_id);

        return response()->json(['masters' => $rows, 'employees' => $rows]);
    }

    public function store(Request $request): JsonResponse
    {
        $user = $request->user();
        if ($denied = $this->assertPayrollMasterAdmin($user)) {
            return $denied;
        }

        $master = $this->service->create($request->all(), (string) $user->company_id, $user->id);

        return response()->json(['master' => $this->service->formatRow($master)], 201);
    }

    public function update(Request $request, string $id): JsonResponse
    {
        $user = $request->user();
        if ($denied = $this->assertPayrollMasterAdmin($user)) {
            return $denied;
        }

        $master = HrmsPayrollMaster::findOrFail($id);
        $master = $this->service->update($master, $request->all(), (string) $user->company_id);

        return response()->json(['master' => $this->service->formatRow($master)]);
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

    public function import(Request $request): JsonResponse
    {
        $user = $request->user();
        if ($denied = $this->assertPayrollMasterAdmin($user)) {
            return $denied;
        }

        $request->validate(['file' => ['required', 'file', 'mimes:csv,xlsx,xls', 'max:10240']]);
        $result = $this->service->importFile($request->file('file'), $user->company_id, $user->id);

        return response()->json($result, ($result['summary']['failed_rows'] ?? 0) > 0 ? 422 : 200);
    }

    public function importPreview(Request $request): JsonResponse
    {
        $user = $request->user();
        if ($denied = $this->assertPayrollMasterAdmin($user)) {
            return $denied;
        }

        $request->validate(['file' => ['required', 'file', 'mimes:csv,xlsx,xls', 'max:10240']]);
        $result = $this->service->previewImportFile($request->file('file'), $user->company_id);

        return response()->json($result);
    }

    public function importTemplate(Request $request): StreamedResponse
    {
        if ($denied = $this->assertPayrollMasterAdmin($request->user())) {
            abort(403);
        }
        $format = $request->query('format') === 'csv' ? 'csv' : 'xlsx';

        return $this->service->templateDownload($format);
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
