<?php

namespace Tests\Unit;

use App\Support\SearchText;
use PHPUnit\Framework\TestCase;

/** Run Payroll employee search: extra spaces in the typed text or in the stored name do not matter. */
final class SearchTextTest extends TestCase
{
    private const STORED = 'Prakashchandra  Sukanraj Dahiya'; // two spaces, as in Payroll Master

    public function test_single_spaced_text_finds_a_double_spaced_name(): void
    {
        $this->assertTrue(SearchText::matches('Prakashchandra Sukanraj', '064', self::STORED, 'p@example.com'));
        $this->assertTrue(SearchText::matches('prakashchandra sukanraj dahiya', '064', self::STORED));
    }

    public function test_extra_spaces_in_the_typed_text_do_not_matter(): void
    {
        $this->assertTrue(SearchText::matches("  Prakashchandra   Sukanraj  ", '064', self::STORED));
        $this->assertTrue(SearchText::matches("Sukanraj\tDahiya", '064', self::STORED));
        $this->assertTrue(SearchText::matches("Sukanraj\u{00A0}Dahiya", '064', self::STORED), 'a non-breaking space counts as a space');
    }

    public function test_double_spaced_names_with_three_parts_match_each_way(): void
    {
        $this->assertTrue(SearchText::matches('Shubhangi Vijaykumar Dalvi', '062', 'Shubhangi  Vijaykumar  Dalvi'));
        $this->assertTrue(SearchText::matches('Shubhangi  Vijaykumar  Dalvi', '062', 'Shubhangi Vijaykumar Dalvi'));
    }

    public function test_other_searches_behave_as_before(): void
    {
        $this->assertTrue(SearchText::matches('064', '064', self::STORED), 'employee code');
        $this->assertTrue(SearchText::matches('DAHIYA', '064', self::STORED), 'case-insensitive');
        $this->assertTrue(SearchText::matches('p@example', '064', self::STORED, 'p@example.com'), 'email');
        $this->assertFalse(SearchText::matches('Sukanraj Patil', '064', self::STORED), 'words must still match');
        $this->assertFalse(SearchText::matches('Prakashchandra Dahiya', '064', self::STORED), 'a skipped word does not match');
        $this->assertTrue(SearchText::matches('   ', '064', self::STORED), 'a blank search matches everything');
    }

    public function test_normalize_collapses_and_trims(): void
    {
        $this->assertSame('a b c', SearchText::normalize("  A  B\n\tC "));
        $this->assertSame('', SearchText::normalize(null));
    }
}
