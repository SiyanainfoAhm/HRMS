<?php

namespace App\Support;

final class QuarterTypes
{
    public const TYPE_I = 'Type I';

    public const TYPE_II = 'Type II';

    public const TYPE_III = 'Type III';

    public const TYPE_IV = 'Type IV';

    public const TYPE_V = 'Type V';

    public const OTHER = 'Other';

    /** @return list<string> */
    public static function all(): array
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
}
