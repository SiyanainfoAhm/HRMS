<?php

namespace Tests\Unit;

use App\Support\GovernmentPayLevel;
use PHPUnit\Framework\TestCase;

final class GovernmentPayLevelTest extends TestCase
{
    public function test_allowed_levels_are_one_through_eighteen(): void
    {
        $this->assertSame(range(1, 18), GovernmentPayLevel::allowed());
    }

    public function test_normalize_accepts_numeric_levels(): void
    {
        $this->assertSame(7, GovernmentPayLevel::normalize(7));
        $this->assertSame(1, GovernmentPayLevel::normalize('1'));
    }

    public function test_normalize_accepts_level_label(): void
    {
        $this->assertSame(5, GovernmentPayLevel::normalize('Level 5'));
        $this->assertSame(9, GovernmentPayLevel::normalize('level 9'));
    }

    public function test_normalize_accepts_level_ten_and_eleven(): void
    {
        $this->assertSame(10, GovernmentPayLevel::normalize('Level 10'));
        $this->assertSame(11, GovernmentPayLevel::normalize(11));
    }

    public function test_normalize_rejects_invalid_levels(): void
    {
        $this->assertNull(GovernmentPayLevel::normalize(33));
        $this->assertNull(GovernmentPayLevel::normalize('Level 33'));
        $this->assertNull(GovernmentPayLevel::normalize(0));
        $this->assertNull(GovernmentPayLevel::normalize(''));
        $this->assertNull(GovernmentPayLevel::normalize('1.5'));
    }
}
