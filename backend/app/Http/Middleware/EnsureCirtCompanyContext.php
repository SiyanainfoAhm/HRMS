<?php

namespace App\Http\Middleware;

use App\Services\DefaultCompanyService;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Ensures authenticated users are scoped to the fixed CIRT company.
 */
class EnsureCirtCompanyContext
{
    public function __construct(
        private readonly DefaultCompanyService $defaultCompanyService,
    ) {}

    public function handle(Request $request, Closure $next): Response
    {
        $user = $request->user();
        if ($user) {
            $this->defaultCompanyService->ensureUserOnDefaultCompany($user);
        }

        return $next($request);
    }
}
