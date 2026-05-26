<?php

return [

    'defaults' => [
        'guard' => 'web',
        'passwords' => 'users',
    ],

    'guards' => [
        'web' => [
            'driver' => 'session',
            'provider' => 'hrms_users',
        ],
        'sanctum' => [
            'driver' => 'sanctum',
            'provider' => 'hrms_users',
        ],
    ],

    'providers' => [
        'hrms_users' => [
            'driver' => 'eloquent',
            'model' => App\Models\HrmsUser::class,
        ],
    ],

    'passwords' => [
        'users' => [
            'provider' => 'hrms_users',
            'table' => 'password_reset_tokens',
            'expire' => 60,
            'throttle' => 60,
        ],
    ],

    'password_timeout' => 10800,

];
