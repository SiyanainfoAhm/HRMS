<?php

namespace App\Http\Middleware;

use App\Services\ActivityLogService;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

final class RecordActivityLog
{
    public function __construct(private readonly ActivityLogService $activityLogs) {}

    public function handle(Request $request, Closure $next): Response
    {
        $before = $this->activityLogs->captureConfigurationSnapshot($request);
        $draftBefore = $this->activityLogs->captureDraftSnapshot($request);
        try {
            $response = $next($request);
        } catch (\Throwable $exception) {
            if (str_ends_with(ltrim($request->path(), '/'), 'auth/login')) {
                $this->activityLogs->recordRequest($request, response()->json([], 422));
            }
            throw $exception;
        }
        $this->activityLogs->recordRequest($request, $response, $before, $draftBefore);
        if (! $response->headers->has('X-Request-ID')) {
            $response->headers->set('X-Request-ID', (string) $request->header('X-Request-ID', \Illuminate\Support\Str::uuid()));
        }

        return $response;
    }
}
