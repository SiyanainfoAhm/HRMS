<?php

use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__.'/../routes/web.php',
        api: __DIR__.'/../routes/api.php',
        commands: __DIR__.'/../routes/console.php',
        health: '/up',
    )
    ->withMiddleware(function (Middleware $middleware) {
        $middleware->alias([
            'hrms.session' => \App\Http\Middleware\ValidateHrmsSession::class,
            'cirt.company' => \App\Http\Middleware\EnsureCirtCompanyContext::class,
            'managerial' => \App\Http\Middleware\EnsureManagerial::class,
        ]);
    })
    ->withExceptions(function (Exceptions $exceptions) {
        $exceptions->render(function (\Throwable $e, \Illuminate\Http\Request $request) {
            if (! $request->is('api/*') && ! $request->expectsJson()) {
                return null;
            }

            $raw = $e->getMessage();
            if (
                str_contains($raw, 'SQLSTATE[23505]')
                || str_contains($raw, 'ux_cirt_payroll_master_one_current')
                || str_contains($raw, 'duplicate key')
            ) {
                return response()->json([
                    'error' => 'Could not save payroll master because an active record already exists for this employee. Please refresh and try again.',
                    'message' => 'Could not save payroll master because an active record already exists for this employee. Please refresh and try again.',
                ], 409);
            }

            if ($e instanceof \Illuminate\Database\QueryException || str_contains($raw, 'SQLSTATE[')) {
                return response()->json([
                    'error' => 'A database error occurred. Please try again or contact support.',
                    'message' => 'A database error occurred. Please try again or contact support.',
                ], 500);
            }

            return null;
        });
    })->create();