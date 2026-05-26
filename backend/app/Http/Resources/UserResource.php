<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class UserResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'email' => $this->email,
            'name' => $this->name,
            'role' => $this->role?->value ?? $this->role,
            'authProvider' => $this->auth_provider?->value ?? $this->auth_provider ?? 'password',
            'companyId' => $this->company_id,
            'employeeCode' => $this->employee_code ?? '',
            'phone' => $this->phone ?? '',
            'dateOfBirth' => $this->date_of_birth?->format('Y-m-d') ?? '',
            'dateOfJoining' => $this->date_of_joining?->format('Y-m-d') ?? '',
            'currentAddressLine1' => $this->current_address_line1 ?? '',
            'currentAddressLine2' => $this->current_address_line2 ?? '',
            'currentCity' => $this->current_city ?? '',
            'currentState' => $this->current_state ?? '',
            'currentCountry' => $this->current_country ?? '',
            'currentPostalCode' => $this->current_postal_code ?? '',
            'permanentAddressLine1' => $this->permanent_address_line1 ?? '',
            'permanentAddressLine2' => $this->permanent_address_line2 ?? '',
            'permanentCity' => $this->permanent_city ?? '',
            'permanentState' => $this->permanent_state ?? '',
            'permanentCountry' => $this->permanent_country ?? '',
            'permanentPostalCode' => $this->permanent_postal_code ?? '',
            'emergencyContactName' => $this->emergency_contact_name ?? '',
            'emergencyContactPhone' => $this->emergency_contact_phone ?? '',
            'bankName' => $this->bank_name ?? '',
            'bankAccountNumber' => $this->bank_account_number ?? '',
            'bankIfsc' => $this->bank_ifsc ?? '',
            'employmentStatus' => $this->employment_status?->value ?? $this->employment_status ?? 'preboarding',
            'ctc' => $this->ctc !== null ? (float) $this->ctc : null,
            'gender' => $this->gender,
            'designation' => $this->designation ?? '',
            'designationId' => $this->designation_id,
            'departmentId' => $this->department_id,
            'divisionId' => $this->division_id,
            'shiftId' => $this->shift_id,
            'aadhaar' => $this->aadhaar ?? '',
            'pan' => $this->pan ?? '',
            'uanNumber' => $this->uan_number ?? '',
            'pfNumber' => $this->pf_number ?? '',
            'esicNumber' => $this->esic_number ?? '',
            'governmentPayLevel' => $this->government_pay_level,
            'cpfNumber' => $this->cpf_number ?? '',
            'tdsMonthly' => $this->tds_monthly !== null ? (float) $this->tds_monthly : null,
            'createdAt' => $this->created_at?->toIso8601String(),
            'updatedAt' => $this->updated_at?->toIso8601String(),
        ];
    }
}
