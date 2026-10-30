<?php

namespace App\Http\Middleware;

use App\Support\SchemaVersion;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Fails every authenticated API request with a clear 503 when the database
 * schema does not match the deployed code, instead of letting individual
 * queries fail with "undefined column" errors halfway through a payroll save.
 */
class EnsureSchemaCurrent
{
    public function handle(Request $request, Closure $next): Response
    {
        $status = SchemaVersion::status();
        if (! $status['ok']) {
            return response()->json([
                'error' => $status['message'],
                'message' => $status['message'],
                'code' => 'SCHEMA_OUT_OF_DATE',
            ], 503);
        }

        return $next($request);
    }
}
