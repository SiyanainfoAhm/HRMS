<?php

namespace App\Services;

use App\Enums\AuthProvider;
use App\Models\HrmsUser;
use Illuminate\Support\Facades\Hash;
use Illuminate\Validation\ValidationException;

class AuthService
{
    public function __construct(
        private readonly DefaultCompanyService $defaultCompanyService,
    ) {}

    public function login(string $email, string $password): array
    {
        $user = HrmsUser::query()
            ->whereRaw('LOWER(email) = ?', [mb_strtolower(trim($email))])
            ->first();

        if (! $user) {
            throw ValidationException::withMessages([
                'email' => ['Invalid email or password.'],
            ]);
        }

        $provider = $user->auth_provider;
        if ($provider !== null && $provider !== AuthProvider::Password) {
            throw ValidationException::withMessages([
                'email' => ['This account uses Google sign-in. Please continue with Google.'],
            ]);
        }

        if (empty($user->password_hash) || ! Hash::check($password, $user->password_hash)) {
            throw ValidationException::withMessages([
                'email' => ['Invalid email or password.'],
            ]);
        }

        $this->defaultCompanyService->ensureUserOnDefaultCompany($user);

        $token = $user->createToken(
            'hrms-web',
            ['sv:'.$user->auth_session_version]
        );

        return [
            'user' => $user->refresh(),
            'token' => $token->plainTextToken,
            'token_type' => 'Bearer',
        ];
    }

    public function googleLogin(string $idToken, string $mode = 'login'): array
    {
        $payload = $this->verifyGoogleToken($idToken);
        if (! $payload) {
            throw ValidationException::withMessages([
                'idToken' => ['Invalid Google token.'],
            ]);
        }

        $email = mb_strtolower(trim($payload['email'] ?? ''));
        $name = trim($payload['name'] ?? '');
        $emailVerified = ($payload['email_verified'] ?? false) === true
            || ($payload['email_verified'] ?? '') === 'true';

        if (! $email) {
            throw ValidationException::withMessages([
                'idToken' => ['Google token missing email.'],
            ]);
        }
        if (! $emailVerified) {
            throw ValidationException::withMessages([
                'idToken' => ['Google email is not verified.'],
            ]);
        }

        $user = HrmsUser::whereRaw('LOWER(email) = ?', [$email])->first();

        if (! $user && $mode === 'login') {
            throw ValidationException::withMessages([
                'email' => ['No account found for this Google email.'],
            ]);
        }

        if (! $user) {
            $user = HrmsUser::create([
                'email' => $email,
                'password_hash' => null,
                'auth_provider' => AuthProvider::Google->value,
                'name' => $name ?: null,
                'role' => 'admin',
                'auth_session_version' => 0,
                'employment_status' => 'current',
            ]);
        }

        if ($user->employment_status?->value === 'past') {
            throw ValidationException::withMessages([
                'email' => ['This user is offboarded and cannot sign in.'],
            ]);
        }

        $this->defaultCompanyService->ensureUserOnDefaultCompany($user);

        $token = $user->createToken('hrms-web', ['sv:'.$user->auth_session_version]);

        return [
            'user' => $user->refresh(),
            'token' => $token->plainTextToken,
            'token_type' => 'Bearer',
        ];
    }

    private function verifyGoogleToken(string $idToken): ?array
    {
        $clientId = config('services.google.client_id');
        if (! $clientId) {
            return null;
        }

        $response = @file_get_contents(
            'https://oauth2.googleapis.com/tokeninfo?id_token='.urlencode($idToken)
        );

        if ($response === false) {
            return null;
        }

        $data = json_decode($response, true);
        if (! is_array($data) || empty($data['email'])) {
            return null;
        }

        if (($data['aud'] ?? '') !== $clientId) {
            return null;
        }

        return $data;
    }

    public function logout(HrmsUser $user): void
    {
        $user->currentAccessToken()?->delete();
    }

    public function assertTokenSessionVersion(HrmsUser $user): void
    {
        $token = $user->currentAccessToken();
        if (! $token) {
            return;
        }

        $expected = 'sv:'.$user->auth_session_version;
        $abilities = $token->abilities ?? [];

        if (! in_array($expected, $abilities, true)) {
            $token->delete();
            throw ValidationException::withMessages([
                'token' => ['Session expired. Please sign in again.'],
            ]);
        }
    }
}
