<?php

namespace App\Support;

final class ApiPagination
{
    public const DEFAULT_PER_PAGE = 25;

    public const MAX_PER_PAGE = 100;

    public static function resolvePerPage(mixed $raw): int
    {
        $n = (int) $raw;
        if ($n < 1) {
            return self::DEFAULT_PER_PAGE;
        }

        return min($n, self::MAX_PER_PAGE);
    }

    public static function resolvePage(mixed $raw): int
    {
        return max(1, (int) $raw);
    }

    /** @return array{current_page: int, per_page: int, total: int, last_page: int} */
    public static function meta(int $total, int $page, int $perPage): array
    {
        $perPage = max(1, $perPage);
        $lastPage = max(1, (int) ceil($total / $perPage));

        return [
            'current_page' => $page,
            'per_page' => $perPage,
            'total' => $total,
            'last_page' => $lastPage,
        ];
    }

    /**
     * @param  list<mixed>  $data
     * @return array{data: list<mixed>, meta: array<string, int>}
     */
    public static function response(array $data, int $total, int $page, int $perPage): array
    {
        return [
            'data' => $data,
            'meta' => self::meta($total, $page, $perPage),
        ];
    }
}
