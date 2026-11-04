<?php

namespace Tests\Unit;

use App\Support\Money;
use PHPUnit\Framework\TestCase;

/** CIRT CPF rounding: percent of an amount, rounded UP to the next whole rupee (exact on paise). Mirrors src/lib/cpfRule.test.ts. */
final class CpfCeilTest extends TestCase
{
    public function test_percent_of_ceil_rounds_up_to_the_next_rupee(): void
    {
        $this->assertSame(9084.0, Money::percentOfCeil(75698, 12), '12% of 75,698 = 9,083.76');
        $this->assertSame(9000.0, Money::percentOfCeil(75000, 12), 'an exact amount is not bumped');
        $this->assertSame(9001.0, Money::percentOfCeil(75001, 12), '9,000.12 -> 9,001');
        $this->assertSame(9000.0, Money::percentOf(75001, 12), 'normal rounding is unchanged');
        $this->assertSame(0.0, Money::percentOfCeil(0, 12));
        $this->assertSame(0.0, Money::percentOfCeil(100, 0));
        $this->assertSame(0.0, Money::percentOfCeil(null, 12));
    }
}
