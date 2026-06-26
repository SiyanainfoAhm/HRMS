<?php

namespace App\Support;

use Illuminate\Http\UploadedFile;

final class SpreadsheetImportSecurity
{
    public const MAX_BYTES = 10 * 1024 * 1024;

    /** @var list<string> */
    private const ALLOWED_EXTENSIONS = ['csv', 'xlsx', 'xls'];

    /** @var list<string> */
    private const ALLOWED_MIMES = [
        'text/csv',
        'text/plain',
        'application/csv',
        'application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/octet-stream',
        'application/zip',
    ];

    public static function validateUploadedFile(UploadedFile $file): ?string
    {
        if (! $file->isValid()) {
            return 'Upload failed. Please try again.';
        }

        if ($file->getSize() > self::MAX_BYTES) {
            return 'File exceeds the maximum size of 10 MB.';
        }

        $extension = strtolower($file->getClientOriginalExtension());
        if (! in_array($extension, self::ALLOWED_EXTENSIONS, true)) {
            return 'Invalid file type. Only .xlsx, .xls, and .csv files are allowed.';
        }

        $mime = strtolower((string) $file->getMimeType());
        $path = $file->getRealPath() ?: $file->path();
        $finfo = finfo_open(FILEINFO_MIME_TYPE);
        $detected = is_string($path) && is_readable($path) && $finfo !== false
            ? strtolower((string) finfo_file($finfo, $path))
            : $mime;
        if ($finfo !== false) {
            finfo_close($finfo);
        }

        if (! self::mimeAllowed($mime, $extension) && ! self::mimeAllowed($detected, $extension)) {
            return 'Invalid file content. Upload a valid Excel or CSV payroll template.';
        }

        if (in_array($extension, ['xlsx', 'xls'], true) && is_string($path) && is_readable($path)) {
            $handle = @fopen($path, 'rb');
            if ($handle === false) {
                return 'Unable to read uploaded file.';
            }
            $header = fread($handle, 4) ?: '';
            fclose($handle);
            if ($extension === 'xlsx' && $header !== "PK\x03\x04") {
                return 'Invalid Excel file. The file does not appear to be a valid .xlsx workbook.';
            }
            if ($extension === 'xls' && ! str_starts_with($header, "\xD0\xCF\x11\xE0")) {
                return 'Invalid Excel file. The file does not appear to be a valid .xls workbook.';
            }
        }

        return null;
    }

    private static function mimeAllowed(string $mime, string $extension): bool
    {
        if ($mime === '' || $mime === 'application/octet-stream') {
            return true;
        }

        if (! in_array($mime, self::ALLOWED_MIMES, true)) {
            return false;
        }

        if ($extension === 'csv') {
            return str_contains($mime, 'csv') || str_contains($mime, 'text');
        }

        return str_contains($mime, 'excel')
            || str_contains($mime, 'spreadsheet')
            || str_contains($mime, 'zip');
    }

    /**
     * Neutralize spreadsheet formula injection (=, +, -, @).
     */
    public static function sanitizeCellValue(mixed $value): mixed
    {
        if (! is_string($value)) {
            return $value;
        }

        $trimmed = ltrim($value);
        if ($trimmed === '') {
            return $value;
        }

        $first = $trimmed[0];
        if (in_array($first, ['=', '+', '-', '@'], true)) {
            return "'".$value;
        }

        return $value;
    }

    /**
     * @param  list<list<mixed>>  $rows
     * @return list<list<mixed>>
     */
    public static function sanitizeSpreadsheetRows(array $rows): array
    {
        return array_map(
            static fn (array $row) => array_map([self::class, 'sanitizeCellValue'], $row),
            $rows,
        );
    }
}
