<?php

namespace App\Providers;

use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;
use App\Services\DefaultCompanyService;
use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        $this->app->singleton(DefaultCompanyService::class);
    }

    public function boot(): void
    {
        RateLimiter::for('login', function (Request $request) {
            $key = mb_strtolower((string) $request->input('email', '')).'|'.$request->ip();

            return Limit::perMinute(5)->by($key)->response(function () {
                return response()->json([
                    'error' => 'Too many login attempts. Please wait a minute and try again.',
                ], 429);
            });
        });
    }
}
