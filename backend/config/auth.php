<?php

return [

    'defaults' => [
        'guard' => 'web',
        'passwords' => 'users',
    ],

    'guards' => [
        'web' => [
            'driver' => 'session',
            'provider' => 'cirt_users',
        ],
        'sanctum' => [
            'driver' => 'sanctum',
            'provider' => 'cirt_users',
        ],
    ],

    'providers' => [
        'cirt_users' => [
            'driver' => 'eloquent',
            'model' => App\Models\HrmsUser::class,
        ],
    ],

    'passwords' => [
        'users' => [
            'provider' => 'cirt_users',
            'table' => 'password_reset_tokens',
            'expire' => 60,
            'throttle' => 60,
        ],
    ],

    'password_timeout' => 10800,

];
