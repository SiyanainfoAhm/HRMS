<?php

namespace App\Services;

use App\Enums\EmploymentStatus;
use App\Enums\UserRole;
use App\Models\HrmsDepartment;
use App\Models\HrmsDesignation;
use App\Models\HrmsDivision;
use App\Models\HrmsEmployee;
use App\Models\HrmsPayrollMaster;
use App\Models\HrmsUser;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;
use PhpOffice\PhpSpreadsheet\IOFactory;
use PhpOffice\PhpSpreadsheet\Spreadsheet;
use PhpOffice\PhpSpreadsheet\Writer\Csv;
use PhpOffice\PhpSpreadsheet\Writer\Xlsx;
use Symfony\Component\HttpFoundation\StreamedResponse;

final class PayrollMasterService
{
    public function __construct(
        private readonly PayrollCalculationService $calculator,
    ) {}

    /** @return list<array<string, mixed>> */
    public function listForCompany(?string $companyId): array
    {
        $query = HrmsPayrollMaster::query()->orderByDesc('created_at');
        if ($companyId) {
            $query->where('company_id', $companyId);
        }

        return $query->get()->map(fn (HrmsPayrollMaster $m) => $this->formatRow($m))->values()->all();
    }

    public function create(array $payload, string $companyId, string $createdBy, bool $salaryPending = false, bool $provisionUser = true): HrmsPayrollMaster
    {
        $validated = $this->validatePayload($payload, null, $companyId, $salaryPending);
        if ($provisionUser) {
            $this->provisionIdentityRecords($validated, $companyId, true);
        }
        $calc = $this->calculator->calculateMaster($validated);
        $attrs = $this->filterExistingColumns($this->mergeCalculated($validated, $calc, $companyId, $createdBy));

        return HrmsPayrollMaster::create($attrs);
    }

    public function update(HrmsPayrollMaster $master, array $payload, string $companyId): HrmsPayrollMaster
    {
        if ($master->company_id && $master->company_id !== $companyId) {
            abort(403, 'Forbidden');
        }
        $validated = $this->validatePayload($payload, $master->id, $companyId);
        $needsUser = ! ($master->employee_user_id ?? $master->user_id);
        if (! $needsUser) {
            $validated['user_id'] = $master->user_id ?? $master->employee_user_id;
            $validated['employee_user_id'] = $master->employee_user_id ?? $master->user_id;
        }
        $this->provisionIdentityRecords($validated, $companyId, $needsUser);
        $calc = $this->calculator->calculateMaster($validated);
        $attrs = $this->filterExistingColumns($this->mergeCalculated($validated, $calc, $companyId, $master->created_by ?? null));
        $master->update($attrs);

        return $master->refresh();
    }

    public function recalculate(HrmsPayrollMaster $master): HrmsPayrollMaster
    {
        $calc = $this->calculator->calculateMaster($this->masterToCalcInput($master));
        $master->update($this->filterExistingColumns($this->calculatedOnly($calc)));

        return $master->refresh();
    }

    public function recalculateAll(?string $companyId): int
    {
        $query = HrmsPayrollMaster::query()->where('status', 'active');
        if ($companyId) {
            $query->where('company_id', $companyId);
        }
        $count = 0;
        foreach ($query->cursor() as $master) {
            $this->recalculate($master);
            $count++;
        }

        return $count;
    }

    /** @return array{found_employees: int, created_master_rows: int, skipped_existing_rows: int, missing_salary_rows: int} */
    public function syncExistingEmployees(?string $companyId, string $createdBy): array
    {
        $found = 0;
        $created = 0;
        $skipped = 0;
        $missingSalary = 0;

        $employees = HrmsEmployee::query()
            ->when($companyId, fn ($q) => $q->where('company_id', $companyId))
            ->with(['user', 'designation', 'department', 'division'])
            ->get();

        foreach ($employees as $emp) {
            $found++;
            $user = $emp->user;
            if ($this->findExistingMaster($companyId, [
                'employee_code' => $emp->employee_code ?? $user?->employee_code,
                'email' => $emp->email ?? $user?->email,
                'employee_id' => $emp->id,
                'user_id' => $emp->user_id,
            ])) {
                $skipped++;

                continue;
            }

            $gross = (float) ($user?->gross_salary ?? 0);
            $payLevel = (int) ($user?->government_pay_level ?? 0);
            $remarks = ($gross <= 0 || $payLevel <= 0) ? 'Salary details pending' : null;
            if ($remarks) {
                $missingSalary++;
            }

            $payload = [
                'employee_id' => $emp->id,
                'user_id' => $emp->user_id,
                'employee_user_id' => $emp->user_id,
                'employee_code' => $emp->employee_code ?? $user?->employee_code,
                'name' => trim(($emp->first_name ?? '').' '.($emp->last_name ?? '')) ?: $user?->name,
                'email' => $emp->email ?? $user?->email,
                'phone' => $emp->phone ?? $user?->phone,
                'gender' => $user?->gender,
                'designation' => $emp->designation?->title ?? $user?->designation ?? 'Pending',
                'department' => $emp->department?->name,
                'division' => $emp->division?->name,
                'pay_level' => max(1, $payLevel ?: 1),
                'gross_basic_pay' => max(0, $gross),
                'status' => 'active',
                'remarks' => $remarks,
                'effective_from' => now()->toDateString(),
                'date_of_joining' => $emp->date_of_joining?->toDateString() ?? $user?->date_of_joining?->toDateString(),
                'date_of_birth' => $emp->date_of_birth?->toDateString() ?? $user?->date_of_birth?->toDateString(),
                'pan' => $user?->pan,
                'aadhaar' => $user?->aadhaar,
                'uan' => $user?->uan_number,
                'bank_name' => $user?->bank_name,
                'bank_account_number' => $user?->bank_account_number,
                'bank_ifsc' => $user?->bank_ifsc,
            ];

            $this->create($payload, $companyId ?? $emp->company_id, $createdBy, $remarks === 'Salary details pending');
            $created++;
        }

        return [
            'found_employees' => $found,
            'created_master_rows' => $created,
            'skipped_existing_rows' => $skipped,
            'missing_salary_rows' => $missingSalary,
        ];
    }

    /**
     * @return array{
     *     headers: list<string>,
     *     summary: array<string, int>,
     *     rows: list<array<string, mixed>>,
     *     file_errors: list<array{field: string, message: string}>
     * }
     */
    public function previewImportFile(UploadedFile $file, ?string $companyId): array
    {
        $plan = $this->buildImportPlan($file, $companyId);

        return [
            'headers' => $plan['headers'],
            'summary' => $plan['summary'],
            'rows' => array_map(fn (array $item) => [
                'row' => $item['row'],
                'employeeCode' => $item['data']['employee_code'] ?? null,
                'name' => $item['data']['name'] ?? null,
                'email' => $item['data']['email'] ?? null,
                'designation' => $item['data']['designation'] ?? null,
                'payLevel' => $item['data']['pay_level'] ?? null,
                'grossBasicPay' => $item['data']['gross_basic_pay'] ?? null,
                'status' => $item['data']['status'] ?? 'active',
                'remarks' => $item['data']['remarks'] ?? null,
                'action' => $item['action'],
                'valid' => $item['valid'],
                'errors' => $item['errors'],
            ], $plan['rows']),
            'file_errors' => $plan['file_errors'],
        ];
    }

    /**
     * @return array{message: string, summary: array<string, int>, errors: list<array{row: int, field: string, message: string}>}
     */
    public function importFile(UploadedFile $file, ?string $companyId, string $createdBy): array
    {
        $plan = $this->buildImportPlan($file, $companyId);
        $summary = $plan['summary'];
        $errors = [];

        foreach ($plan['file_errors'] as $e) {
            $errors[] = ['row' => 0, 'field' => $e['field'], 'message' => $e['message']];
        }

        if ($plan['file_errors'] !== []) {
            return [
                'message' => 'Import file has header or format errors',
                'summary' => $summary,
                'errors' => $errors,
            ];
        }

        foreach ($plan['rows'] as $item) {
            if (! $item['valid']) {
                $summary['failed_rows']++;
                foreach ($item['errors'] as $e) {
                    $errors[] = ['row' => $item['row'], 'field' => $e['field'], 'message' => $e['message']];
                }

                continue;
            }

            try {
                if ($item['action'] === 'update' && $item['existing']) {
                    $this->update($item['existing'], $item['data'], $companyId ?? $item['existing']->company_id);
                    $summary['updated_rows']++;
                } else {
                    $this->create($item['data'], $companyId ?? '', $createdBy, false, false);
                    $summary['inserted_rows']++;
                }
            } catch (\Throwable $e) {
                $summary['failed_rows']++;
                $errors[] = ['row' => $item['row'], 'field' => 'row', 'message' => $e->getMessage()];
            }
        }

        $message = $errors === []
            ? 'Import completed successfully'
            : 'Import completed with errors';

        return compact('message', 'summary', 'errors');
    }

    /**
     * @return array{
     *     headers: list<string>,
     *     summary: array<string, int>,
     *     rows: list<array{
     *         row: int,
     *         data: array<string, mixed>,
     *         errors: list<array{field: string, message: string}>,
     *         valid: bool,
     *         action: string,
     *         existing: ?HrmsPayrollMaster
     *     }>,
     *     file_errors: list<array{field: string, message: string}>
     * }
     */
    private function buildImportPlan(UploadedFile $file, ?string $companyId): array
    {
        $rows = $this->parseSpreadsheet($file);
        $summary = [
            'total_rows' => 0,
            'valid_rows' => 0,
            'invalid_rows' => 0,
            'insert_rows' => 0,
            'update_rows' => 0,
            'inserted_rows' => 0,
            'updated_rows' => 0,
            'skipped_rows' => 0,
            'failed_rows' => 0,
        ];
        $fileErrors = [];
        $planRows = [];

        if ($rows === []) {
            $fileErrors[] = ['field' => 'file', 'message' => 'Empty file'];

            return [
                'headers' => [],
                'summary' => $summary,
                'rows' => [],
                'file_errors' => $fileErrors,
            ];
        }

        $header = array_shift($rows);
        $map = $this->normalizeHeaders($header);
        $headers = array_values(array_filter($map));
        $requiredHeaders = ['name', 'pay_level', 'gross_basic_pay'];
        $missing = array_values(array_diff($requiredHeaders, $headers));
        if ($missing !== []) {
            $fileErrors[] = [
                'field' => 'headers',
                'message' => 'Missing required columns: '.implode(', ', $missing),
            ];
        }

        $rowNum = 1;
        foreach ($rows as $rawRow) {
            $rowNum++;
            if ($this->isEmptyRow($rawRow)) {
                continue;
            }
            $summary['total_rows']++;
            $columnError = $this->validateImportColumnCount($header, $rawRow);
            $row = $this->mapRow($map, $rawRow);
            $repair = $this->repairImportRowAlignment($row);
            $row = $repair['row'];
            if (! empty($row['status'])) {
                $row['status'] = mb_strtolower(trim((string) $row['status']));
            }
            $rowErrors = $this->validateImportRow($row, $companyId);
            if ($columnError !== null && ! $repair['fixed']) {
                array_unshift($rowErrors, $columnError);
            }
            $existing = $this->findExistingMaster($companyId, $row);
            $action = $existing ? 'update' : 'insert';
            $valid = $rowErrors === [];

            if ($valid) {
                $summary['valid_rows']++;
                if ($action === 'update') {
                    $summary['update_rows']++;
                } else {
                    $summary['insert_rows']++;
                }
            } else {
                $summary['invalid_rows']++;
            }

            $planRows[] = [
                'row' => $rowNum,
                'data' => $row,
                'errors' => $rowErrors,
                'valid' => $valid,
                'action' => $action,
                'existing' => $existing,
            ];
        }

        if ($summary['total_rows'] === 0 && $fileErrors === []) {
            $fileErrors[] = ['field' => 'file', 'message' => 'No data rows found'];
        }

        return [
            'headers' => $headers,
            'summary' => $summary,
            'rows' => $planRows,
            'file_errors' => $fileErrors,
        ];
    }

    public function exportSpreadsheet(?string $companyId, string $format = 'xlsx'): StreamedResponse
    {
        $rows = $this->listForCompany($companyId);
        $headers = $this->templateHeaders();
        $sheet = new Spreadsheet;
        $sheet->getActiveSheet()->fromArray($headers, null, 'A1');
        $i = 2;
        foreach ($rows as $r) {
            $sheet->getActiveSheet()->fromArray($this->rowToExport($r), null, 'A'.$i);
            $i++;
        }

        $filename = 'cirt_payroll_master_'.date('Ymd_His').'.'.($format === 'csv' ? 'csv' : 'xlsx');

        return response()->streamDownload(function () use ($sheet, $format) {
            if ($format === 'csv') {
                $writer = new Csv($sheet);
                $writer->setDelimiter(',');
                $writer->save('php://output');
            } else {
                (new Xlsx($sheet))->save('php://output');
            }
        }, $filename, [
            'Content-Type' => $format === 'csv'
                ? 'text/csv'
                : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        ]);
    }

    public function templateDownload(string $format = 'xlsx'): StreamedResponse
    {
        $headers = $this->templateHeaders();
        $sample = $this->sampleTemplateRow();
        $sheet = new Spreadsheet;
        $sheet->getActiveSheet()->fromArray($headers, null, 'A1');
        $sheet->getActiveSheet()->fromArray($sample, null, 'A2');

        $filename = 'cirt_payroll_master_template.'.($format === 'csv' ? 'csv' : 'xlsx');

        return response()->streamDownload(function () use ($sheet, $format) {
            if ($format === 'csv') {
                (new Csv($sheet))->save('php://output');
            } else {
                (new Xlsx($sheet))->save('php://output');
            }
        }, $filename);
    }

    public function deactivate(HrmsPayrollMaster $master): HrmsPayrollMaster
    {
        $master->update([
            'status' => 'inactive',
            'effective_to' => now()->toDateString(),
            'effective_end_date' => now()->toDateString(),
            'updated_at' => now(),
        ]);

        return $master->refresh();
    }

    /** @return list<string> */
    private function templateHeaders(): array
    {
        return [
            'employee_code', 'name', 'email', 'phone', 'gender', 'date_of_birth', 'date_of_joining',
            'designation', 'department', 'division', 'pay_level', 'gross_basic_pay', 'da_percent', 'hra_percent', 'medical',
            'uan', 'cpf_no', 'pan', 'aadhaar', 'bank_name', 'bank_account_number', 'bank_ifsc',
            'status', 'remarks', 'effective_from',
            'professional_tax', 'income_tax', 'lic', 'mess', 'welfare', 'vpf', 'pf_loan', 'post_office',
            'credit_society', 'standard_licence_fee', 'electricity', 'water', 'horticulture', 'vehicle_charge',
            'other_deduction', 'advance',
        ];
    }

    /** @return list<string|int|float> */
    private function sampleTemplateRow(): array
    {
        $byHeader = [
            'employee_code' => 'EMP001',
            'name' => 'Test Employee',
            'email' => 'test@example.com',
            'phone' => '9876543210',
            'gender' => 'male',
            'date_of_birth' => '1990-01-01',
            'date_of_joining' => '2026-05-01',
            'designation' => 'Developer',
            'department' => 'IT Department',
            'division' => 'Admin',
            'pay_level' => 8,
            'gross_basic_pay' => 52000,
            'da_percent' => 60,
            'hra_percent' => 30,
            'medical' => 3000,
            'uan' => 'UAN123',
            'cpf_no' => 'CPF123',
            'pan' => 'ABCDE1234F',
            'aadhaar' => '123456789012',
            'bank_name' => 'Test Bank',
            'bank_account_number' => '1234567890',
            'bank_ifsc' => 'TEST0001234',
            'status' => 'active',
            'remarks' => 'Imported from template',
            'effective_from' => '2026-06-01',
            'professional_tax' => 200,
            'income_tax' => 0,
            'lic' => 0,
            'mess' => 0,
            'welfare' => 80,
            'vpf' => 0,
            'pf_loan' => 0,
            'post_office' => 0,
            'credit_society' => 0,
            'standard_licence_fee' => 0,
            'electricity' => 0,
            'water' => 0,
            'horticulture' => 0,
            'vehicle_charge' => 0,
            'other_deduction' => 0,
            'advance' => 0,
        ];

        return array_map(fn (string $h) => $byHeader[$h] ?? '', $this->templateHeaders());
    }

    /** @param  array<string, mixed>  $r */
    private function rowToExport(array $r): array
    {
        return array_map(fn ($h) => $r[$h] ?? $r[Str::camel($h)] ?? '', $this->templateHeaders());
    }

    private function resolveTakeHome(HrmsPayrollMaster $m): float
    {
        if ($m->take_home !== null && $m->take_home !== '') {
            return (float) $m->take_home;
        }

        $calc = $this->calculator->calculateMaster($this->masterToCalcInput($m));

        return (float) $calc['take_home'];
    }

    /** @return array<string, mixed> */
    public function formatRow(HrmsPayrollMaster $m): array
    {
        $userId = $m->user_id ?? $m->employee_user_id;
        $userRole = UserRole::Employee->value;
        if ($userId) {
            $user = HrmsUser::find($userId);
            if ($user) {
                $role = $user->role;
                $userRole = $role instanceof UserRole
                    ? $role->value
                    : UserRole::fromStored(is_string($role) ? $role : null)->value;
            }
        }

        return [
            'id' => $m->id,
            'companyId' => $m->company_id,
            'employeeId' => $m->employee_id,
            'userId' => $userId,
            'employeeUserId' => $userId,
            'userRole' => $userRole,
            'employeeCode' => $m->employee_code,
            'name' => $m->name,
            'email' => $m->email,
            'phone' => $m->phone,
            'gender' => $m->gender,
            'designation' => $m->designation,
            'department' => $m->department,
            'division' => $m->division,
            'payLevel' => $m->pay_level ?? $m->getAttributes()['pay_level'] ?? null,
            'grossBasicPay' => (float) ($m->gross_basic_pay ?? $m->gross_basic ?? $m->gross_salary ?? 0),
            'daPercent' => (float) ($m->da_percent ?? PayrollCalculationService::DEFAULT_DA_PERCENT),
            'hraPercent' => (float) ($m->hra_percent ?? PayrollCalculationService::DEFAULT_HRA_PERCENT),
            'medical' => (float) ($m->medical ?? $m->medical_fixed ?? PayrollCalculationService::DEFAULT_MEDICAL),
            'transportBase' => (float) ($m->transport_base ?? 0),
            'transportDa' => (float) ($m->transport_da ?? 0),
            'transportTotal' => (float) ($m->transport_total ?? $m->trans ?? 0),
            'totalEarnings' => (float) ($m->total_earnings ?? $m->ctc ?? 0),
            'cpfDefault' => (float) ($m->cpf_default ?? 0),
            'cpfEffective' => (float) ($m->cpf_effective ?? 0),
            'daCpf' => (float) ($m->da_cpf ?? $m->da_cpf_default ?? 0),
            'professionalTax' => (float) ($m->professional_tax ?? $m->pt_default ?? $m->pt ?? 0),
            'incomeTax' => (float) ($m->income_tax ?? $m->income_tax_default ?? $m->tds ?? 0),
            'lic' => (float) ($m->lic ?? $m->lic_default ?? 0),
            'mess' => (float) ($m->mess ?? $m->mess_default ?? 0),
            'welfare' => (float) ($m->welfare ?? $m->welfare_default ?? 0),
            'vpf' => (float) ($m->vpf ?? $m->vpf_default ?? 0),
            'pfLoan' => (float) ($m->pf_loan ?? $m->pf_loan_default ?? 0),
            'postOffice' => (float) ($m->post_office ?? $m->post_office_default ?? 0),
            'creditSociety' => (float) ($m->credit_society ?? $m->credit_society_default ?? 0),
            'standardLicenceFee' => (float) ($m->standard_licence_fee ?? $m->std_licence_fee_default ?? 0),
            'electricity' => (float) ($m->electricity ?? $m->electricity_default ?? 0),
            'water' => (float) ($m->water ?? $m->water_default ?? 0),
            'horticulture' => (float) ($m->horticulture ?? $m->horticulture_default ?? 0),
            'vehicleCharge' => (float) ($m->vehicle_charge ?? $m->veh_charge_default ?? 0),
            'otherDeduction' => (float) ($m->other_deduction ?? $m->other_deduction_default ?? 0),
            'advance' => (float) ($m->advance ?? $m->advance_bonus ?? 0),
            'takeHome' => $this->resolveTakeHome($m),
            'uan' => $m->uan,
            'cpfNo' => $m->cpf_no,
            'pan' => $m->pan,
            'aadhaar' => $m->aadhaar,
            'bankName' => $m->bank_name,
            'bankAccountNumber' => $m->bank_account_number,
            'bankIfsc' => $m->bank_ifsc,
            'dateOfJoining' => $m->date_of_joining?->toDateString() ?? null,
            'dateOfBirth' => $m->date_of_birth?->toDateString() ?? null,
            'status' => $m->status ?? 'active',
            'remarks' => $m->remarks,
            'effectiveFrom' => $m->effective_from?->toDateString() ?? $m->effective_start_date?->toDateString(),
            'effectiveTo' => $m->effective_to?->toDateString() ?? $m->effective_end_date?->toDateString(),
            'payrollMode' => $m->payroll_mode ?? 'government',
        ];
    }

    /** @param  array<string, mixed>  $payload */
    private function validatePayload(array $payload, ?string $ignoreId, ?string $companyId, bool $salaryPending = false): array
    {
        if (empty($payload['name'])) {
            abort(422, 'Name is required');
        }
        if (empty($payload['pay_level']) && empty($payload['payLevel'])) {
            abort(422, 'Pay level is required');
        }
        $gross = (float) ($payload['gross_basic_pay'] ?? $payload['grossBasicPay'] ?? 0);
        if (! $salaryPending && $gross <= 0) {
            abort(422, 'Gross basic pay must be greater than 0');
        }
        if (! $salaryPending && empty($payload['designation'])) {
            abort(422, 'Designation is required');
        }
        if (! $salaryPending && empty($payload['email'])) {
            abort(422, 'Email is required');
        }

        $code = $payload['employee_code'] ?? $payload['employeeCode'] ?? null;
        if ($code) {
            $q = HrmsPayrollMaster::where('employee_code', $code);
            if ($companyId) {
                $q->where('company_id', $companyId);
            }
            if ($ignoreId) {
                $q->where('id', '!=', $ignoreId);
            }
            if ($q->exists()) {
                abort(422, 'Employee code already exists');
            }
        }

        foreach (['cpf_no' => 'cpfNo', 'uan' => 'uan'] as $col => $camel) {
            $val = $payload[$col] ?? $payload[$camel] ?? null;
            if (! $val) {
                continue;
            }
            $q = HrmsPayrollMaster::where($col, $val);
            if ($companyId) {
                $q->where('company_id', $companyId);
            }
            if ($ignoreId) {
                $q->where('id', '!=', $ignoreId);
            }
            if ($q->exists()) {
                abort(422, ucfirst(str_replace('_', ' ', $col)).' already exists');
            }
        }

        return $payload;
    }

    /** @param  array<string, mixed>  $payload */
    private function validatePasswordComplexity(array $payload): void
    {
        $password = $payload['password'] ?? null;
        if (! is_string($password) || trim($password) === '') {
            return;
        }

        if (strlen($password) < 8) {
            abort(422, 'Password must be at least 8 characters');
        }
        if (! preg_match('/[A-Z]/', $password)) {
            abort(422, 'Password must include at least one uppercase letter');
        }
        if (! preg_match('/[a-z]/', $password)) {
            abort(422, 'Password must include at least one lowercase letter');
        }
        if (! preg_match('/[0-9]/', $password)) {
            abort(422, 'Password must include at least one number');
        }
        if (! preg_match('/[^A-Za-z0-9]/', $password)) {
            abort(422, 'Password must include at least one special character');
        }
        if (strlen($password) > 255) {
            abort(422, 'Password is too long');
        }
    }

    /** @param  array<string, mixed>  $payload */
    private function requirePasswordForNewUser(array $payload): void
    {
        $password = $payload['password'] ?? null;
        if (! is_string($password) || trim($password) === '') {
            abort(422, 'Password is required for new employee login');
        }
        $this->validatePasswordComplexity($payload);
    }

    /** @param  array<string, mixed>  $payload */
    private function hashPasswordFromPayload(array $payload): ?string
    {
        $password = $payload['password'] ?? null;
        if (! is_string($password) || trim($password) === '') {
            return null;
        }

        $this->validatePasswordComplexity($payload);

        return Hash::make($password);
    }

    /** @param  array<string, mixed>  $payload */
    private function applyPasswordToUser(HrmsUser $user, array $payload): void
    {
        $hash = $this->hashPasswordFromPayload($payload);
        if (! $hash) {
            return;
        }

        $user->update([
            'password_hash' => $hash,
            'auth_session_version' => (int) ($user->auth_session_version ?? 0) + 1,
        ]);
    }

    /** @param  array<string, mixed>  $validated */
    /** @param  array<string, mixed>  $calc */
    private function mergeCalculated(array $validated, array $calc, ?string $companyId, ?string $createdBy): array
    {
        $userId = $validated['user_id'] ?? $validated['userId'] ?? $validated['employee_user_id'] ?? $validated['employeeUserId'] ?? null;
        $effectiveFrom = $validated['effective_from'] ?? $validated['effectiveFrom'] ?? now()->toDateString();

        $attrs = [
            'company_id' => $companyId,
            'employee_id' => $validated['employee_id'] ?? $validated['employeeId'] ?? null,
            'employee_code' => $validated['employee_code'] ?? $validated['employeeCode'] ?? null,
            'name' => $validated['name'],
            'email' => $validated['email'] ?? null,
            'phone' => $validated['phone'] ?? null,
            'gender' => $validated['gender'] ?? null,
            'designation' => $validated['designation'] ?? 'Pending',
            'department' => $validated['department'] ?? null,
            'division' => $validated['division'] ?? null,
            'pay_level' => $calc['pay_level'],
            'gross_basic_pay' => $calc['gross_basic_pay'],
            'gross_basic' => $calc['gross_basic_pay'],
            'gross_salary' => $calc['gross_basic_pay'],
            'da_percent' => $calc['da_percent'],
            'hra_percent' => $calc['hra_percent'],
            'medical_fixed' => $calc['medical'],
            'transport_base' => $calc['transport_base'],
            'transport_da' => $calc['transport_da'],
            'transport_total' => $calc['transport_total'],
            'transport_da_percent' => $calc['transport_da_percent'],
            'transport_slab_group' => $calc['transport_slab_group'],
            'trans' => $calc['transport_total'],
            'basic' => $calc['gross_basic_pay'],
            'hra' => $calc['hra_amount'],
            'total_earnings' => $calc['total_earnings'],
            'ctc' => $calc['total_earnings'],
            'cpf_default' => $calc['cpf_default'],
            'cpf_effective' => $calc['cpf_effective'],
            'da_cpf' => $calc['da_cpf'],
            'da_cpf_default' => $calc['da_cpf'],
            'professional_tax' => $calc['professional_tax'],
            'pt' => $calc['professional_tax'],
            'pt_default' => $calc['professional_tax'],
            'income_tax' => $calc['income_tax'],
            'income_tax_default' => $calc['income_tax'],
            'tds' => $calc['income_tax'],
            'lic' => $calc['lic'],
            'lic_default' => $calc['lic'],
            'mess' => $calc['mess'],
            'mess_default' => $calc['mess'],
            'welfare' => $calc['welfare'],
            'welfare_default' => $calc['welfare'],
            'vpf' => $calc['vpf'],
            'vpf_default' => $calc['vpf'],
            'pf_loan' => $calc['pf_loan'],
            'pf_loan_default' => $calc['pf_loan'],
            'post_office' => $calc['post_office'],
            'post_office_default' => $calc['post_office'],
            'credit_society' => $calc['credit_society'],
            'credit_society_default' => $calc['credit_society'],
            'standard_licence_fee' => $calc['standard_licence_fee'],
            'std_licence_fee_default' => $calc['standard_licence_fee'],
            'electricity' => $calc['electricity'],
            'electricity_default' => $calc['electricity'],
            'water' => $calc['water'],
            'water_default' => $calc['water'],
            'horticulture' => $calc['horticulture'],
            'horticulture_default' => $calc['horticulture'],
            'vehicle_charge' => $calc['vehicle_charge'],
            'veh_charge_default' => $calc['vehicle_charge'],
            'other_deduction' => $calc['other_deduction'],
            'other_deduction_default' => $calc['other_deduction'],
            'advance' => $calc['advance'],
            'advance_bonus' => $calc['advance'],
            'take_home' => $calc['take_home'],
            'uan' => $validated['uan'] ?? null,
            'cpf_no' => $validated['cpf_no'] ?? $validated['cpfNo'] ?? null,
            'pan' => $validated['pan'] ?? null,
            'aadhaar' => $validated['aadhaar'] ?? null,
            'bank_name' => $validated['bank_name'] ?? $validated['bankName'] ?? null,
            'bank_account_number' => $validated['bank_account_number'] ?? $validated['bankAccountNumber'] ?? null,
            'bank_ifsc' => $validated['bank_ifsc'] ?? $validated['bankIfsc'] ?? null,
            'date_of_joining' => $validated['date_of_joining'] ?? $validated['dateOfJoining'] ?? null,
            'date_of_birth' => $validated['date_of_birth'] ?? $validated['dateOfBirth'] ?? null,
            'status' => $validated['status'] ?? 'active',
            'remarks' => $validated['remarks'] ?? null,
            'effective_from' => $effectiveFrom,
            'effective_start_date' => $effectiveFrom,
            'effective_to' => $validated['effective_to'] ?? $validated['effectiveTo'] ?? null,
            'effective_end_date' => $validated['effective_to'] ?? $validated['effectiveTo'] ?? null,
            'payroll_mode' => 'government',
            'pf_eligible' => false,
            'esic_eligible' => false,
            'created_by' => $createdBy,
            'updated_at' => now(),
        ];

        $userId = $this->resolveLinkedUserId($validated, $companyId, $userId);
        if ($userId) {
            $attrs['user_id'] = $userId;
            $attrs['employee_user_id'] = $userId;
        }

        return $attrs;
    }

    /** @param  array<string, mixed>  $validated */
    private function provisionIdentityRecords(array &$validated, string $companyId, bool $createIfMissing): void
    {
        $explicit = $validated['user_id'] ?? $validated['userId'] ?? $validated['employee_user_id'] ?? $validated['employeeUserId'] ?? null;
        $userId = $this->resolveLinkedUserId($validated, $companyId, $explicit);

        if ($userId) {
            $validated['user_id'] = $userId;
            $validated['employee_user_id'] = $userId;
            $employee = HrmsEmployee::query()
                ->where('company_id', $companyId)
                ->where('user_id', $userId)
                ->first();
            if ($employee) {
                $validated['employee_id'] = $employee->id;
            }
            $this->syncUserProfileFromPayroll($userId, $validated);

            return;
        }

        if (! $createIfMissing) {
            return;
        }

        $email = trim((string) ($validated['email'] ?? ''));
        if ($email === '') {
            abort(422, 'Email is required to create the employee user record');
        }

        $this->requirePasswordForNewUser($validated);

        $user = $this->createUserFromPayrollPayload($validated, $companyId);
        $employee = $this->createEmployeeFromPayrollPayload($validated, $companyId, $user);

        $validated['user_id'] = $user->id;
        $validated['employee_user_id'] = $user->id;
        $validated['employee_id'] = $employee->id;
    }

    /** @param  array<string, mixed>  $validated */
    private function createUserFromPayrollPayload(array $validated, string $companyId): HrmsUser
    {
        $email = mb_strtolower(trim((string) $validated['email']));
        $payLevel = (int) ($validated['pay_level'] ?? $validated['payLevel'] ?? 1);
        $gross = (float) ($validated['gross_basic_pay'] ?? $validated['grossBasicPay'] ?? 0);
        $code = trim((string) ($validated['employee_code'] ?? $validated['employeeCode'] ?? ''));
        if ($code === '') {
            $code = $this->generateEmployeeCode();
            $validated['employee_code'] = $code;
        }

        $passwordHash = $this->hashPasswordFromPayload($validated);
        if (! $passwordHash) {
            abort(422, 'Password is required for new employee login');
        }

        return HrmsUser::create([
            'email' => $email,
            'password_hash' => $passwordHash,
            'name' => trim((string) ($validated['name'] ?? '')),
            'role' => $this->resolveRoleFromPayload($validated),
            'auth_provider' => 'password',
            'auth_session_version' => 0,
            'company_id' => $companyId,
            'employee_code' => $code,
            'employment_status' => EmploymentStatus::Current,
            'phone' => $validated['phone'] ?? null,
            'date_of_birth' => $validated['date_of_birth'] ?? $validated['dateOfBirth'] ?? null,
            'date_of_joining' => $validated['date_of_joining'] ?? $validated['dateOfJoining'] ?? null,
            'gender' => $validated['gender'] ?? null,
            'designation' => $validated['designation'] ?? null,
            'gross_salary' => $gross > 0 ? $gross : null,
            'government_pay_level' => $payLevel,
            'aadhaar' => $validated['aadhaar'] ?? null,
            'pan' => $validated['pan'] ?? null,
            'uan_number' => $validated['uan'] ?? null,
            'cpf_number' => $validated['cpf_no'] ?? $validated['cpfNo'] ?? null,
            'bank_name' => $validated['bank_name'] ?? $validated['bankName'] ?? null,
            'bank_account_number' => $validated['bank_account_number'] ?? $validated['bankAccountNumber'] ?? null,
            'bank_ifsc' => $validated['bank_ifsc'] ?? $validated['bankIfsc'] ?? null,
            'tds_monthly' => (float) ($validated['income_tax'] ?? $validated['incomeTax'] ?? 0) ?: null,
        ]);
    }

    /** @param  array<string, mixed>  $validated */
    private function createEmployeeFromPayrollPayload(array $validated, string $companyId, HrmsUser $user): HrmsEmployee
    {
        [$firstName, $lastName] = $this->splitFullName((string) ($validated['name'] ?? $user->name ?? 'Employee'));

        return HrmsEmployee::create([
            'user_id' => $user->id,
            'company_id' => $companyId,
            'employee_code' => $user->employee_code,
            'first_name' => $firstName,
            'last_name' => $lastName,
            'email' => $user->email,
            'phone' => $validated['phone'] ?? $user->phone,
            'date_of_birth' => $validated['date_of_birth'] ?? $validated['dateOfBirth'] ?? $user->date_of_birth,
            'date_of_joining' => $validated['date_of_joining'] ?? $validated['dateOfJoining'] ?? $user->date_of_joining,
            'is_active' => true,
        ]);
    }

    /** @param  array<string, mixed>  $validated */
    private function syncUserProfileFromPayroll(string $userId, array $validated): void
    {
        $user = HrmsUser::find($userId);
        if (! $user) {
            return;
        }

        $payLevel = (int) ($validated['pay_level'] ?? $validated['payLevel'] ?? 0);
        $gross = (float) ($validated['gross_basic_pay'] ?? $validated['grossBasicPay'] ?? 0);

        $user->update(array_filter([
            'name' => $validated['name'] ?? $user->name,
            'phone' => $validated['phone'] ?? $user->phone,
            'gender' => $validated['gender'] ?? $user->gender,
            'designation' => $validated['designation'] ?? $user->designation,
            'role' => $this->resolveRoleFromPayload($validated)->value,
            'employment_status' => EmploymentStatus::Current,
            'government_pay_level' => $payLevel > 0 ? $payLevel : $user->government_pay_level,
            'gross_salary' => $gross > 0 ? $gross : $user->gross_salary,
            'aadhaar' => $validated['aadhaar'] ?? $user->aadhaar,
            'pan' => $validated['pan'] ?? $user->pan,
            'uan_number' => $validated['uan'] ?? $user->uan_number,
            'cpf_number' => $validated['cpf_no'] ?? $validated['cpfNo'] ?? $user->cpf_number,
            'bank_name' => $validated['bank_name'] ?? $validated['bankName'] ?? $user->bank_name,
            'bank_account_number' => $validated['bank_account_number'] ?? $validated['bankAccountNumber'] ?? $user->bank_account_number,
            'bank_ifsc' => $validated['bank_ifsc'] ?? $validated['bankIfsc'] ?? $user->bank_ifsc,
        ], fn ($v) => $v !== null && $v !== ''));

        $this->applyPasswordToUser($user, $validated);
    }

    /** @param  array<string, mixed>  $validated */
    private function resolveRoleFromPayload(array $validated): UserRole
    {
        $raw = $validated['role'] ?? $validated['userRole'] ?? $validated['user_role'] ?? null;
        if ($raw instanceof UserRole) {
            return $raw;
        }
        if ($raw === null || $raw === '') {
            return UserRole::Employee;
        }

        return UserRole::fromStored(is_string($raw) ? $raw : null);
    }

    /** @return array{0: string, 1: ?string} */
    private function splitFullName(string $name): array
    {
        $trimmed = trim($name);
        if ($trimmed === '') {
            return ['Employee', null];
        }
        $parts = preg_split('/\s+/', $trimmed, 2);

        return [$parts[0], $parts[1] ?? null];
    }

    private function generateEmployeeCode(): string
    {
        $alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        for ($attempt = 0; $attempt < 10; $attempt++) {
            $code = 'EMP-';
            for ($i = 0; $i < 8; $i++) {
                $code .= $alphabet[random_int(0, strlen($alphabet) - 1)];
            }
            if (! HrmsUser::where('employee_code', $code)->exists()) {
                return $code;
            }
        }

        return 'EMP-'.strtoupper(substr(bin2hex(random_bytes(4)), 0, 8));
    }

    private function normalizeEmailForMatch(string $email): string
    {
        $email = mb_strtolower(trim($email));
        if (! str_contains($email, '@')) {
            return $email;
        }
        [$local, $domain] = explode('@', $email, 2);

        return str_replace('.', '', $local).'@'.$domain;
    }

    /** @param  array<string, mixed>  $validated */
    private function resolveLinkedUserId(array $validated, ?string $companyId, ?string $explicitUserId): ?string
    {
        if ($explicitUserId) {
            return $explicitUserId;
        }

        if (! $companyId) {
            return null;
        }

        $email = trim((string) ($validated['email'] ?? ''));
        if ($email !== '') {
            $lower = mb_strtolower($email);
            $exact = HrmsUser::query()
                ->where('company_id', $companyId)
                ->whereRaw('LOWER(email) = ?', [$lower])
                ->value('id');
            if ($exact) {
                return $exact;
            }

            $normalized = $this->normalizeEmailForMatch($email);
            $candidates = HrmsUser::query()
                ->where('company_id', $companyId)
                ->whereNotNull('email')
                ->get(['id', 'email']);
            foreach ($candidates as $candidate) {
                if ($this->normalizeEmailForMatch((string) $candidate->email) === $normalized) {
                    return $candidate->id;
                }
            }
        }

        $code = trim((string) ($validated['employee_code'] ?? $validated['employeeCode'] ?? ''));
        if ($code !== '') {
            $byCode = HrmsUser::query()
                ->where('company_id', $companyId)
                ->where('employee_code', $code)
                ->value('id');
            if ($byCode) {
                return $byCode;
            }
        }

        return null;
    }

    /** @param  array<string, mixed>  $calc */
    private function calculatedOnly(array $calc): array
    {
        return [
            'gross_basic_pay' => $calc['gross_basic_pay'],
            'gross_basic' => $calc['gross_basic_pay'],
            'gross_salary' => $calc['gross_basic_pay'],
            'transport_base' => $calc['transport_base'],
            'transport_da' => $calc['transport_da'],
            'transport_total' => $calc['transport_total'],
            'trans' => $calc['transport_total'],
            'total_earnings' => $calc['total_earnings'],
            'ctc' => $calc['total_earnings'],
            'cpf_effective' => $calc['cpf_effective'],
            'take_home' => $calc['take_home'],
            'updated_at' => now(),
        ] + $this->mergeDeductionColumns($calc);
    }

    /** @param  array<string, mixed>  $calc */
    private function mergeDeductionColumns(array $calc): array
    {
        return [
            'da_percent' => $calc['da_percent'],
            'hra_percent' => $calc['hra_percent'],
            'hra' => $calc['hra_amount'],
            'basic' => $calc['gross_basic_pay'],
            'medical_fixed' => $calc['medical'],
            'professional_tax' => $calc['professional_tax'],
            'pt' => $calc['professional_tax'],
            'income_tax' => $calc['income_tax'],
            'tds' => $calc['income_tax'],
            'lic' => $calc['lic'],
            'mess' => $calc['mess'],
            'welfare' => $calc['welfare'],
            'vpf' => $calc['vpf'],
            'pf_loan' => $calc['pf_loan'],
            'advance' => $calc['advance'],
            'da_cpf' => $calc['da_cpf'],
        ];
    }

    /** @param  array<string, mixed>  $attrs */
    /** @return array<string, mixed> */
    private function filterExistingColumns(array $attrs): array
    {
        static $columns = null;
        if ($columns === null) {
            $columns = array_flip(Schema::getColumnListing('cirt_payroll_master'));
        }

        return array_intersect_key($attrs, $columns);
    }

    private function masterToCalcInput(HrmsPayrollMaster $m): array
    {
        return $m->only([
            'pay_level', 'gross_basic_pay', 'gross_basic', 'gross_salary', 'da_percent', 'hra_percent',
            'medical', 'medical_fixed', 'transport_da_percent', 'cpf_default', 'da_cpf', 'da_cpf_default',
            'income_tax', 'income_tax_default', 'tds', 'professional_tax', 'pt', 'pt_default',
            'lic', 'lic_default', 'mess', 'mess_default', 'welfare', 'welfare_default',
            'vpf', 'vpf_default', 'pf_loan', 'pf_loan_default', 'post_office', 'post_office_default',
            'credit_society', 'credit_society_default', 'standard_licence_fee', 'std_licence_fee_default',
            'electricity', 'electricity_default', 'water', 'water_default', 'horticulture', 'horticulture_default',
            'vehicle_charge', 'veh_charge_default', 'other_deduction', 'other_deduction_default',
            'advance', 'advance_bonus',
        ]);
    }

    /** @param  array<string, mixed>  $criteria */
    private function findExistingMaster(?string $companyId, array $criteria): ?HrmsPayrollMaster
    {
        $q = HrmsPayrollMaster::query();
        if ($companyId) {
            $q->where('company_id', $companyId);
        }

        if (! empty($criteria['employee_code'])) {
            $found = (clone $q)->where('employee_code', $criteria['employee_code'])->first();
            if ($found) {
                return $found;
            }
        }
        if (! empty($criteria['cpf_no'])) {
            $found = (clone $q)->where('cpf_no', $criteria['cpf_no'])->first();
            if ($found) {
                return $found;
            }
        }
        if (! empty($criteria['uan'])) {
            $found = (clone $q)->where('uan', $criteria['uan'])->first();
            if ($found) {
                return $found;
            }
        }
        if (! empty($criteria['email'])) {
            $found = (clone $q)->whereRaw('LOWER(email) = ?', [mb_strtolower($criteria['email'])])->first();
            if ($found) {
                return $found;
            }
        }
        if (! empty($criteria['employee_id'])) {
            $found = (clone $q)->where('employee_id', $criteria['employee_id'])->first();
            if ($found) {
                return $found;
            }
        }
        if (! empty($criteria['user_id'])) {
            $found = (clone $q)->where(function ($w) use ($criteria) {
                $w->where('user_id', $criteria['user_id'])
                    ->orWhere('employee_user_id', $criteria['user_id']);
            })->first();
            if ($found) {
                return $found;
            }
        }
        if (! empty($criteria['name']) && ! empty($criteria['pay_level'])) {
            return (clone $q)->whereRaw('LOWER(name) = ?', [mb_strtolower($criteria['name'])])
                ->where('pay_level', $criteria['pay_level'])
                ->first();
        }

        return null;
    }

    /** @return list<list<mixed>> */
    private function parseSpreadsheet(UploadedFile $file): array
    {
        $path = $file->getRealPath() ?: $file->path();
        $spreadsheet = IOFactory::load($path);
        $sheet = $spreadsheet->getActiveSheet();

        return $sheet->toArray(null, true, true, false);
    }

    /** @param  list<mixed>  $header */
    /** @return array<int, string> */
    private function normalizeHeaders(array $header): array
    {
        $aliases = $this->headerAliases();
        $map = [];
        foreach ($header as $i => $cell) {
            $key = $this->normHeaderKey((string) $cell);
            $map[$i] = $aliases[$key] ?? $key;
        }

        return $map;
    }

    /** @return array<string, string> */
    private function headerAliases(): array
    {
        return [
            'code' => 'employee_code',
            'emp_code' => 'employee_code',
            'employee id' => 'employee_code',
            'employee code' => 'employee_code',
            'employee name' => 'name',
            'name of employee' => 'name',
            'staff name' => 'name',
            'post' => 'designation',
            'dept' => 'department',
            'div' => 'division',
            'level' => 'pay_level',
            'pay level' => 'pay_level',
            'p_level' => 'pay_level',
            'basic' => 'gross_basic_pay',
            'gross basic' => 'gross_basic_pay',
            'gross basic pay' => 'gross_basic_pay',
            'basic pay' => 'gross_basic_pay',
            'uan no' => 'uan',
            'uan' => 'uan',
            'cpf no' => 'cpf_no',
            'gpf no' => 'cpf_no',
            'pf no' => 'cpf_no',
            'account no' => 'bank_account_number',
            'bank account' => 'bank_account_number',
            'bank account number' => 'bank_account_number',
            'ifsc code' => 'bank_ifsc',
            'ifsc' => 'bank_ifsc',
            'mobile' => 'phone',
            'phone number' => 'phone',
        ];
    }

    private function normHeaderKey(string $h): string
    {
        return preg_replace('/\s+/', ' ', mb_strtolower(trim($h))) ?? '';
    }

    /** @param  array<int, string>  $map */
    /** @param  list<mixed>  $raw */
    /** @return array<string, mixed> */
    private function mapRow(array $map, array $raw): array
    {
        $row = [];
        foreach ($map as $i => $field) {
            if ($field === '') {
                continue;
            }
            $row[$field] = $raw[$i] ?? null;
        }

        return $row;
    }

    /** @param  list<mixed>  $row */
    private function isEmptyRow(array $row): bool
    {
        foreach ($row as $cell) {
            if ($cell !== null && trim((string) $cell) !== '') {
                return false;
            }
        }

        return true;
    }

    /** @param  list<mixed>  $header */
    /** @param  list<mixed>  $raw */
    /** @return array{field: string, message: string}|null */
    private function validateImportColumnCount(array $header, array $raw): ?array
    {
        $headerCount = count($header);
        $lastFilled = -1;
        foreach ($raw as $i => $cell) {
            if ($cell !== null && trim((string) $cell) !== '') {
                $lastFilled = $i;
            }
        }
        $filledCount = $lastFilled + 1;
        if ($filledCount > 0 && $filledCount < $headerCount) {
            return [
                'field' => 'columns',
                'message' => "Row has {$filledCount} columns with data but the template expects {$headerCount}. Download the latest template or check for a missing column (often advance before status in older files).",
            ];
        }

        return null;
    }

    /** @param  array<string, mixed>  $row */
    /** @return array{row: array<string, mixed>, fixed: bool} */
    private function repairImportRowAlignment(array $row): array
    {
        $allowedStatuses = ['active', 'inactive', 'retired', 'deceased', 'resigned'];
        $status = mb_strtolower(trim((string) ($row['status'] ?? 'active')));

        if (in_array($status, $allowedStatuses, true)) {
            return ['row' => $row, 'fixed' => false];
        }

        $advance = mb_strtolower(trim((string) ($row['advance'] ?? '')));
        $remarks = trim((string) ($row['remarks'] ?? ''));

        // Older templates missing the advance column: advance=active, status=remarks text, remarks=effective date.
        if (in_array($advance, $allowedStatuses, true)) {
            if ($status !== '' && ! in_array($status, $allowedStatuses, true)) {
                $row['remarks'] = $row['status'];
            }
            if (preg_match('/^\d{4}-\d{2}-\d{2}/', $remarks)) {
                $row['effective_from'] = $remarks;
            }
            $row['status'] = $advance;
            $row['advance'] = 0;

            return ['row' => $row, 'fixed' => true];
        }

        if ($status !== '' && str_contains($status, ' ')) {
            if (preg_match('/^\d{4}-\d{2}-\d{2}/', $remarks)) {
                $row['effective_from'] = $remarks;
            }
            $row['remarks'] = $row['status'];
            $row['status'] = 'active';

            return ['row' => $row, 'fixed' => true];
        }

        return ['row' => $row, 'fixed' => false];
    }

    /** @param  array<string, mixed>  $row */
    /** @return list<array{field: string, message: string}> */
    private function validateImportRow(array $row, ?string $companyId): array
    {
        $errors = [];
        if (empty($row['name'])) {
            $errors[] = ['field' => 'name', 'message' => 'Name is required'];
        }
        if (empty($row['pay_level'])) {
            $errors[] = ['field' => 'pay_level', 'message' => 'Pay level is required'];
        }
        $gross = (float) ($row['gross_basic_pay'] ?? 0);
        if ($gross <= 0) {
            $errors[] = ['field' => 'gross_basic_pay', 'message' => 'Gross basic pay must be greater than 0'];
        }
        if (! empty($row['email']) && ! filter_var($row['email'], FILTER_VALIDATE_EMAIL)) {
            $errors[] = ['field' => 'email', 'message' => 'Invalid email'];
        }
        if (! empty($row['aadhaar']) && ! preg_match('/^\d{12}$/', preg_replace('/\D/', '', (string) $row['aadhaar']))) {
            $errors[] = ['field' => 'aadhaar', 'message' => 'Aadhaar must be 12 digits'];
        }
        if (! empty($row['pan']) && ! preg_match('/^[A-Z]{5}\d{4}[A-Z]$/i', (string) $row['pan'])) {
            $errors[] = ['field' => 'pan', 'message' => 'Invalid PAN format'];
        }
        $status = mb_strtolower(trim((string) ($row['status'] ?? 'active')));
        $allowedStatuses = ['active', 'inactive', 'retired', 'deceased', 'resigned'];
        if ($status !== '' && ! in_array($status, $allowedStatuses, true)) {
            $errors[] = [
                'field' => 'status',
                'message' => 'Status must be one of: '.implode(', ', $allowedStatuses).'. Re-download the latest import template if columns are misaligned.',
            ];
        } elseif (strlen($status) > 20) {
            $errors[] = ['field' => 'status', 'message' => 'Status must be at most 20 characters'];
        }

        return $errors;
    }
}
