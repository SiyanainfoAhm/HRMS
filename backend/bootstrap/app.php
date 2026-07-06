<?php

use App\Http\Middleware\EnsureCirtCompanyContext;
use App\Http\Middleware\EnsureManagerial;
use App\Http\Middleware\EnsureRole;
use App\Http\Middleware\ValidateHrmsSession;
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Auth\AuthenticationException;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpKernel\Exception\HttpExceptionInterface;
use Throwable;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__.'/../routes/web.php',
        api: __DIR__.'/../routes/api.php',
        apiPrefix: 'api',
        health: '/up',
    )
    ->withMiddleware(function (Middleware $middleware) {
        $middleware->alias([
            'role' => EnsureRole::class,
            'managerial' => EnsureManagerial::class,
            'hrms.session' => ValidateHrmsSession::class,
            'cirt.company' => EnsureCirtCompanyContext::class,
        ]);
    })
    ->withExceptions(function (Exceptions $exceptions) {
        $exceptions->render(function (Throwable $e, Request $request) {
            if (! $request->is('api/*') && ! $request->expectsJson()) {
                return null;
            }

            if ($e instanceof AuthenticationException) {
                return response()->json(['error' => 'Unauthorized'], 401);
            }

            if ($e instanceof AuthorizationException) {
                return response()->json(['error' => 'Forbidden'], 403);
            }

            if ($e instanceof ModelNotFoundException) {
                return response()->json(['error' => 'Not found'], 404);
            }

            if ($e instanceof ValidationException) {
                $message = collect($e->errors())->flatten()->first() ?? 'Validation failed.';

                return response()->json(['error' => $message], 422);
            }

            if ($e instanceof HttpExceptionInterface) {
                return response()->json(
                    ['error' => $e->getMessage() ?: 'Request failed'],
                    $e->getStatusCode(),
                );
            }

            if (! config('app.debug')) {
                report($e);

                return response()->json(['error' => 'An error occurred. Please try again.'], 500);
            }

            return null;
        });
    })->create();
