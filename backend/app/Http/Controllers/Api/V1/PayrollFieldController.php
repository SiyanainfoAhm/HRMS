<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Services\PayrollFieldService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class PayrollFieldController extends Controller
{
    public function __construct(
        private readonly PayrollFieldService $service,
    ) {}

    public function config(Request $request): JsonResponse
    {
        $group = $request->query('group');
        $activeOnly = $request->query('active_only', '1') !== '0';

        return response()->json(
            $this->service->getPayrollConfig(
                $request->user()->company_id,
                is_string($group) ? $group : null,
                $activeOnly,
            ),
        );
    }

    public function index(Request $request): JsonResponse
    {
        $group = $request->query('group');
        $activeOnlyParam = $request->query('active_only');

        // active_only=0 → return all fields (active + inactive) for settings management
        $active = match ($activeOnlyParam) {
            null, '1', 'true' => true,
            '0', 'false', 'all' => null,
            default => true,
        };

        return response()->json([
            'fields' => $this->service->listFields(
                $request->user()->company_id,
                is_string($group) ? $group : null,
                $active,
            ),
        ]);
    }

    public function store(Request $request): JsonResponse
    {
        $data = $request->validate([
            'field_label' => ['required_without:fieldLabel', 'string', 'max:128'],
            'fieldLabel' => ['sometimes', 'string', 'max:128'],
            'field_key' => ['nullable', 'string', 'max:64'],
            'fieldKey' => ['sometimes', 'string', 'max:64'],
            'field_group' => ['required_without:fieldGroup', 'string'],
            'fieldGroup' => ['sometimes', 'string'],
            'field_type' => ['nullable', 'string'],
            'fieldType' => ['sometimes', 'string'],
            'calculation_type' => ['nullable', 'string'],
            'calculationType' => ['sometimes', 'string'],
            'default_value' => ['nullable', 'string'],
            'defaultValue' => ['nullable', 'string'],
            'dropdown_options' => ['nullable', 'array'],
            'dropdownOptions' => ['nullable', 'array'],
            'is_required' => ['nullable', 'boolean'],
            'isRequired' => ['nullable', 'boolean'],
            'show_in_payroll_master' => ['nullable', 'boolean'],
            'showInPayrollMaster' => ['nullable', 'boolean'],
            'show_in_run_payroll' => ['nullable', 'boolean'],
            'showInRunPayroll' => ['nullable', 'boolean'],
            'show_in_salary_slip' => ['nullable', 'boolean'],
            'showInSalarySlip' => ['nullable', 'boolean'],
            'include_in_total_earnings' => ['nullable', 'boolean'],
            'includeInTotalEarnings' => ['nullable', 'boolean'],
            'include_in_total_deductions' => ['nullable', 'boolean'],
            'includeInTotalDeductions' => ['nullable', 'boolean'],
            'display_order' => ['nullable', 'integer'],
            'displayOrder' => ['nullable', 'integer'],
        ]);

        $field = $this->service->createField(
            $request->user()->company_id,
            $data,
            $request->user()->id,
        );

        return response()->json(['field' => $field], 201);
    }

    public function update(Request $request, string $id): JsonResponse
    {
        $data = $request->validate([
            'field_label' => ['sometimes', 'string', 'max:128'],
            'fieldLabel' => ['sometimes', 'string', 'max:128'],
            'field_key' => ['sometimes', 'string', 'max:64'],
            'fieldKey' => ['sometimes', 'string', 'max:64'],
            'field_group' => ['sometimes', 'string'],
            'fieldGroup' => ['sometimes', 'string'],
            'field_type' => ['sometimes', 'string'],
            'fieldType' => ['sometimes', 'string'],
            'calculation_type' => ['sometimes', 'string'],
            'calculationType' => ['sometimes', 'string'],
            'default_value' => ['nullable', 'string'],
            'defaultValue' => ['nullable', 'string'],
            'dropdown_options' => ['nullable', 'array'],
            'dropdownOptions' => ['nullable', 'array'],
            'is_required' => ['nullable', 'boolean'],
            'isRequired' => ['nullable', 'boolean'],
            'show_in_payroll_master' => ['nullable', 'boolean'],
            'showInPayrollMaster' => ['nullable', 'boolean'],
            'show_in_run_payroll' => ['nullable', 'boolean'],
            'showInRunPayroll' => ['nullable', 'boolean'],
            'show_in_salary_slip' => ['nullable', 'boolean'],
            'showInSalarySlip' => ['nullable', 'boolean'],
            'include_in_total_earnings' => ['nullable', 'boolean'],
            'includeInTotalEarnings' => ['nullable', 'boolean'],
            'include_in_total_deductions' => ['nullable', 'boolean'],
            'includeInTotalDeductions' => ['nullable', 'boolean'],
            'is_active' => ['nullable', 'boolean'],
            'isActive' => ['nullable', 'boolean'],
            'display_order' => ['nullable', 'integer'],
            'displayOrder' => ['nullable', 'integer'],
        ]);

        $field = $this->service->updateField($request->user()->company_id, $id, $data);

        return response()->json(['field' => $field]);
    }

    public function deactivate(Request $request, string $id): JsonResponse
    {
        $field = $this->service->deactivateField($request->user()->company_id, $id);

        return response()->json(['field' => $field]);
    }

    public function destroy(Request $request, string $id): JsonResponse
    {
        $this->service->deleteField($request->user()->company_id, $id);

        return response()->json(['ok' => true]);
    }

    public function calculationSettings(Request $request): JsonResponse
    {
        if ($request->isMethod('GET')) {
            $config = $this->service->getPayrollConfig($request->user()->company_id);

            return response()->json(['calculationSettings' => $config['calculationSettings']]);
        }

        $data = $request->validate([
            'cpf_percentage' => ['required_without:cpfPercentage', 'numeric', 'min:0'],
            'cpfPercentage' => ['sometimes', 'numeric', 'min:0'],
            'cpf_basis_field_keys' => ['sometimes', 'array'],
            'cpfBasisFieldKeys' => ['sometimes', 'array'],
            'cpf_calculation_mode' => ['sometimes', 'in:percentage,fixed_amount'],
            'cpfCalculationMode' => ['sometimes', 'in:percentage,fixed_amount'],
            'cpf_fixed_amount' => ['sometimes', 'numeric', 'min:0'],
            'cpfFixedAmount' => ['sometimes', 'numeric', 'min:0'],
            'electricity_unit_rate' => ['sometimes', 'numeric', 'min:0'],
            'electricityUnitRate' => ['sometimes', 'numeric', 'min:0'],
            'night_allowance_basic_ceiling' => ['sometimes', 'numeric', 'min:0'],
            'nightAllowanceBasicCeiling' => ['sometimes', 'numeric', 'min:0'],
        ]);

        $settings = $this->service->saveCalculationSettings($request->user()->company_id, $data);

        return response()->json(['calculationSettings' => $settings]);
    }
}
