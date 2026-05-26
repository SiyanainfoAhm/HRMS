<?php

namespace App\Http\Middleware;

use App\Services\AuthService;
use Closure;
use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpFoundation\Response;

class ValidateHrmsSession
{
    public function __construct(
        private readonly AuthService $authService,
    ) {}

    /**
     * @param  \Closure(\Illuminate\Http\Request): (\Symfony\Component\HttpFoundation\Response)  $next
     */
    public function handle(Request $request, Closure $next): Response
    {
        $user = $request->user();
        if ($user) {
            try {
                $this->authService->assertTokenSessionVersion($user);
            } catch (ValidationException) {
                return response()->json(['error' => 'Session expired. Please sign in again.'], 401);
            }
        }

        return $next($request);
    }
}
