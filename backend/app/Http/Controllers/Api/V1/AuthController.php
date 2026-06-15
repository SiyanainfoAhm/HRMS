<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Http\Requests\Auth\ChangePasswordRequest;
use App\Http\Requests\Auth\LoginRequest;
use App\Http\Requests\Auth\SignupRequest;
use App\Http\Resources\SessionUserResource;
use App\Http\Resources\UserResource;
use App\Models\HrmsUser;
use App\Services\AuthService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Illuminate\Validation\ValidationException;

class AuthController extends Controller
{
    public function __construct(
        private readonly AuthService $authService,
    ) {}

    public function login(LoginRequest $request): JsonResponse
    {
        try {
            $result = $this->authService->login(
                $request->validated('email'),
                $request->validated('password'),
            );
        } catch (ValidationException $e) {
            $message = collect($e->errors())->flatten()->first() ?? 'Login failed.';
            $status = str_contains($message, 'Google') ? 400 : 401;

            return response()->json(['error' => $message], $status);
        }

        return response()->json([
            'user' => new SessionUserResource($result['user']),
            'token' => $result['token'],
            'tokenType' => $result['token_type'],
        ]);
    }

    public function signup(SignupRequest $request): JsonResponse
    {
        $email = mb_strtolower(trim($request->validated('email')));

        $existing = HrmsUser::whereRaw('LOWER(email) = ?', [$email])->exists();
        if ($existing) {
            return response()->json(['error' => 'Email already registered'], 409);
        }

        $employeeCode = $this->generateEmployeeCode();

        $user = HrmsUser::create([
            'email' => $email,
            'password_hash' => Hash::make($request->validated('password')),
            'name' => $request->validated('name'),
            'role' => 'admin',
            'auth_provider' => 'password',
            'auth_session_version' => 0,
            'employee_code' => $employeeCode,
            'employment_status' => 'current',
        ]);

        $token = $user->createToken('hrms-web', ['sv:0']);

        return response()->json([
            'user' => new SessionUserResource($user),
            'token' => $token->plainTextToken,
            'tokenType' => 'Bearer',
        ], 201);
    }

    public function google(Request $request): JsonResponse
    {
        $request->validate([
            'idToken' => ['required', 'string'],
            'mode' => ['sometimes', 'in:login,signup'],
        ]);

        try {
            $result = $this->authService->googleLogin(
                $request->input('idToken'),
                $request->input('mode', 'login'),
            );
        } catch (ValidationException $e) {
            $message = collect($e->errors())->flatten()->first() ?? 'Google sign-in failed.';

            return response()->json(['error' => $message], 400);
        }

        return response()->json([
            'user' => new SessionUserResource($result['user']),
            'token' => $result['token'],
            'tokenType' => $result['token_type'],
        ]);
    }

    public function logout(Request $request): JsonResponse
    {
        $this->authService->logout($request->user());

        return response()->json(['message' => 'Logged out']);
    }

    public function me(Request $request): JsonResponse
    {
        $user = $request->user();
        $user->refresh();

        return response()->json([
            'user' => new UserResource($user),
        ]);
    }

    public function changePassword(ChangePasswordRequest $request): JsonResponse
    {
        /** @var HrmsUser $user */
        $user = $request->user();

        if (! Hash::check($request->validated('current_password'), $user->password_hash)) {
            return response()->json(['error' => 'Current password is incorrect'], 422);
        }

        $newHash = Hash::make($request->validated('new_password'));
        $nextSv = ($user->auth_session_version ?? 0) + 1;

        $user->update([
            'password_hash' => $newHash,
            'auth_session_version' => $nextSv,
            'updated_at' => now(),
        ]);

        $user->tokens()->delete();

        $token = $user->createToken('hrms-web', ['sv:'.$nextSv]);

        return response()->json([
            'user' => new SessionUserResource($user->refresh()),
            'token' => $token->plainTextToken,
            'tokenType' => 'Bearer',
        ]);
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
}
