<?php

namespace App\Http\Middleware;

use App\Enums\UserRole;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class EnsureRole
{
    /**
     * @param  \Closure(\Illuminate\Http\Request): (\Symfony\Component\HttpFoundation\Response)  $next
     * @param  string  ...$roles  Role values: super_admin, admin, hr, manager, employee
     */
    public function handle(Request $request, Closure $next, string ...$roles): Response
    {
        $user = $request->user();
        if (! $user) {
            return response()->json(['error' => 'Unauthorized'], 401);
        }

        $role = $user->role instanceof UserRole ? $user->role->value : (string) $user->role;

        if ($roles !== [] && ! in_array($role, $roles, true)) {
            return response()->json(['error' => 'Forbidden'], 403);
        }

        return $next($request);
    }
}
