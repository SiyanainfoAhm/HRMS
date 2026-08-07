<?php

namespace App\Support;

/**
 * Default quarter type labels used when seeding a company.
 * Runtime allow-list lives in cirt_quarter_types.
 */
final class QuarterTypes
{
    public const TYPE_I = 'Type I';

    public const TYPE_II = 'Type II';

    public const TYPE_III = 'Type III';

    public const TYPE_IV = 'Type IV';

    public const TYPE_V = 'Type V';

    public const OTHER = 'Other';

    /** @return list<string> */
    public static function defaults(): array
    {
        return [
            self::TYPE_I,
            self::TYPE_II,
            self::TYPE_III,
            self::TYPE_IV,
            self::TYPE_V,
            self::OTHER,
        ];
    }

    /** @deprecated Use QuarterTypeService / DB master. Kept for older call sites. */
    public static function all(): array
    {
        return self::defaults();
    }
}
