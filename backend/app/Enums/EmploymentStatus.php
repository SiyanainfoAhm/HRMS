<?php

namespace App\Enums;

enum EmploymentStatus: string
{
    case Preboarding = 'preboarding';
    case Current = 'current';
    case Past = 'past';
}
