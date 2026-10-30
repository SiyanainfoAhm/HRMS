<?php

namespace App\Exceptions;

use RuntimeException;

final class PayrollConcurrencyException extends RuntimeException
{
    public function __construct(
        public readonly int|string|null $currentRevision,
        public readonly string $resource,
        public readonly ?string $resourceId = null,
    ) {
        parent::__construct('Payroll was updated in another tab or session. Reload the latest values before saving.');
    }
}
