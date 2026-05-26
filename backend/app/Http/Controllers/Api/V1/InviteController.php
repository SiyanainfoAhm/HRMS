<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Models\HrmsCompany;
use App\Models\HrmsCompanyDocument;
use App\Models\HrmsEmployeeDocumentSubmission;
use App\Models\HrmsEmployeeInvite;
use App\Models\HrmsUser;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;

class InviteController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $invites = HrmsEmployeeInvite::where('company_id', $request->user()->company_id)
            ->orderBy('created_at', 'desc')
            ->get();

        return response()->json(['invites' => $invites]);
    }

    public function store(Request $request): JsonResponse
    {
        $user = $request->user();
        if (! $user->role?->isManagerial()) {
            return response()->json(['error' => 'Forbidden'], 403);
        }

        $data = $request->validate([
            'email' => ['required', 'email', 'max:255'],
            'requested_document_ids' => ['nullable', 'array'],
            'requested_document_ids.*' => ['uuid'],
        ]);

        $existingUser = HrmsUser::whereRaw('LOWER(email) = ?', [mb_strtolower(trim($data['email']))])->first();

        $invite = HrmsEmployeeInvite::create([
            'company_id' => $user->company_id,
            'user_id' => $existingUser?->id,
            'email' => mb_strtolower(trim($data['email'])),
            'token' => Str::random(32),
            'requested_document_ids' => $data['requested_document_ids'] ?? null,
            'status' => 'pending',
            'expires_at' => now()->addDays(30),
            'created_by' => $user->id,
        ]);

        $frontendUrl = rtrim(env('CORS_ALLOWED_ORIGINS', 'http://localhost:3000'), '/');
        $inviteUrl = $frontendUrl.'/invites/'.$invite->token;

        return response()->json(['invite' => $invite, 'inviteUrl' => $inviteUrl], 201);
    }

    public function showByToken(Request $request, string $token): JsonResponse
    {
        $invite = HrmsEmployeeInvite::where('token', $token)->firstOrFail();
        $company = HrmsCompany::find($invite->company_id);

        $documents = [];
        if ($invite->requested_document_ids) {
            $documents = HrmsCompanyDocument::whereIn('id', $invite->requested_document_ids)->get();
        }

        $submissions = HrmsEmployeeDocumentSubmission::where('invite_id', $invite->id)->get();

        $user = null;
        if ($invite->user_id) {
            $u = HrmsUser::find($invite->user_id);
            if ($u) {
                $user = [
                    'name' => $u->name,
                    'phone' => $u->phone,
                    'authProvider' => $u->auth_provider?->value ?? 'password',
                    'dateOfBirth' => $u->date_of_birth?->format('Y-m-d'),
                    'currentAddressLine1' => $u->current_address_line1,
                    'currentAddressLine2' => $u->current_address_line2,
                    'currentCity' => $u->current_city,
                    'currentState' => $u->current_state,
                    'currentCountry' => $u->current_country,
                    'currentPostalCode' => $u->current_postal_code,
                    'permanentAddressLine1' => $u->permanent_address_line1,
                    'permanentAddressLine2' => $u->permanent_address_line2,
                    'permanentCity' => $u->permanent_city,
                    'permanentState' => $u->permanent_state,
                    'permanentCountry' => $u->permanent_country,
                    'permanentPostalCode' => $u->permanent_postal_code,
                    'aadhaar' => $u->aadhaar,
                    'pan' => $u->pan,
                    'bankName' => $u->bank_name,
                    'bankAccountHolderName' => $u->bank_account_holder_name,
                    'bankAccountNumber' => $u->bank_account_number,
                    'bankIfsc' => $u->bank_ifsc,
                ];
            }
        }

        return response()->json([
            'invite' => $invite,
            'company' => $company,
            'documents' => $documents,
            'submissions' => $submissions,
            'user' => $user,
        ]);
    }

    public function processAction(Request $request, string $token): JsonResponse
    {
        $invite = HrmsEmployeeInvite::where('token', $token)->firstOrFail();
        $action = $request->input('action');

        if ($action === 'submit_document') {
            return $this->handleSubmitDocument($request, $invite);
        }

        if ($action === 'complete') {
            return $this->handleComplete($request, $invite);
        }

        return response()->json(['error' => 'Invalid action'], 400);
    }

    private function handleSubmitDocument(Request $request, HrmsEmployeeInvite $invite): JsonResponse
    {
        $documentId = $request->input('document_id') ?? $request->input('documentId');
        if (! $documentId) {
            return response()->json(['error' => 'document_id is required'], 422);
        }

        $fileUrl = $request->input('file_url') ?? $request->input('fileUrl');
        $signatureName = $request->input('signature_name') ?? $request->input('signatureName');

        $status = $signatureName ? 'signed' : 'submitted';

        $submission = HrmsEmployeeDocumentSubmission::updateOrCreate(
            [
                'invite_id' => $invite->id,
                'document_id' => $documentId,
            ],
            [
                'company_id' => $invite->company_id,
                'user_id' => $invite->user_id,
                'status' => $status,
                'file_url' => $fileUrl,
                'signature_name' => $signatureName,
                'signed_at' => $signatureName ? now() : null,
                'submitted_at' => now(),
            ]
        );

        return response()->json(['submission' => $submission]);
    }

    private function handleComplete(Request $request, HrmsEmployeeInvite $invite): JsonResponse
    {
        $profile = $request->input('profile', []);
        $password = $request->input('password');

        $user = $invite->user_id ? HrmsUser::find($invite->user_id) : null;

        if (! $user) {
            $user = HrmsUser::whereRaw('LOWER(email) = ?', [mb_strtolower($invite->email)])->first();
        }

        if (! $user) {
            if (! $password) {
                return response()->json(['error' => 'Password is required for new accounts'], 422);
            }
            $user = HrmsUser::create([
                'email' => $invite->email,
                'password_hash' => Hash::make($password),
                'name' => $profile['name'] ?? null,
                'role' => 'employee',
                'auth_provider' => 'password',
                'company_id' => $invite->company_id,
                'employment_status' => 'preboarding',
            ]);
            $invite->update(['user_id' => $user->id]);
        } else {
            if ($password) {
                $user->password_hash = Hash::make($password);
            }
        }

        $fieldMap = [
            'name' => 'name',
            'phone' => 'phone',
            'dateOfBirth' => 'date_of_birth',
            'currentAddressLine1' => 'current_address_line1',
            'currentAddressLine2' => 'current_address_line2',
            'currentCity' => 'current_city',
            'currentState' => 'current_state',
            'currentCountry' => 'current_country',
            'currentPostalCode' => 'current_postal_code',
            'permanentAddressLine1' => 'permanent_address_line1',
            'permanentAddressLine2' => 'permanent_address_line2',
            'permanentCity' => 'permanent_city',
            'permanentState' => 'permanent_state',
            'permanentCountry' => 'permanent_country',
            'permanentPostalCode' => 'permanent_postal_code',
            'aadhaar' => 'aadhaar',
            'pan' => 'pan',
            'bankName' => 'bank_name',
            'bankAccountHolderName' => 'bank_account_holder_name',
            'bankAccountNumber' => 'bank_account_number',
            'bankIfsc' => 'bank_ifsc',
        ];

        foreach ($fieldMap as $camel => $snake) {
            if (isset($profile[$camel]) && $profile[$camel] !== '') {
                $user->{$snake} = $profile[$camel];
            }
        }

        $user->save();

        $invite->update([
            'status' => 'completed',
            'completed_at' => now(),
        ]);

        return response()->json(['invite' => $invite->refresh(), 'user' => $user]);
    }

    public function updateByToken(Request $request, string $token): JsonResponse
    {
        $invite = HrmsEmployeeInvite::where('token', $token)->firstOrFail();

        $invite->update([
            'status' => 'completed',
            'completed_at' => now(),
        ]);

        return response()->json(['invite' => $invite->refresh()]);
    }

    public function sendInvite(Request $request): JsonResponse
    {
        $user = $request->user();
        if (! $user->role?->isManagerial()) {
            return response()->json(['error' => 'Forbidden'], 403);
        }

        $data = $request->validate([
            'invite_id' => ['required', 'uuid'],
        ]);

        $invite = HrmsEmployeeInvite::findOrFail($data['invite_id']);

        $frontendUrl = rtrim(env('CORS_ALLOWED_ORIGINS', 'http://localhost:3000'), '/');
        $inviteUrl = $frontendUrl.'/invites/'.$invite->token;

        return response()->json([
            'message' => 'Invite email queued',
            'invite' => $invite,
            'inviteUrl' => $inviteUrl,
        ]);
    }
}
