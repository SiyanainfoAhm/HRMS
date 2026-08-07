<?php

use Illuminate\Support\Facades\Route;

Route::get('/', function () {
    return response()->json([
        'service' => 'HRMS API',
        'version' => 'v1',
        'docs' => '/api/v1',
    ]);
});
