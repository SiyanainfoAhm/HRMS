<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Models\HrmsCompany;
use App\Models\HrmsCompanyDocument;
use App\Models\HrmsEmployeeInvite;
use App\Models\HrmsUser;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
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

        return response()->json(['invite' => $invite], 201);
    }

    public function showByToken(Request $request, string $token): JsonResponse
    {
        $invite = HrmsEmployeeInvite::where('token', $token)->firstOrFail();
        $company = HrmsCompany::find($invite->company_id);

        $documents = [];
        if ($invite->requested_document_ids) {
            $documents = HrmsCompanyDocument::whereIn('id', $invite->requested_document_ids)->get();
        }

        return response()->json([
            'invite' => $invite,
            'company' => $company,
            'documents' => $documents,
        ]);
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

        return response()->json([
            'message' => 'Invite email queued',
            'invite' => $invite,
        ]);
    }
}
