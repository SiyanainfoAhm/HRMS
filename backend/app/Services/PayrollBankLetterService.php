<?php

namespace App\Services;

use App\Models\HrmsPayrollMaster;
use App\Models\HrmsUser;
use Carbon\Carbon;
use InvalidArgumentException;
use PhpOffice\PhpWord\TemplateProcessor;
use Symfony\Component\HttpFoundation\BinaryFileResponse;

class PayrollBankLetterService
{
    public const TEMPLATE_RELATIVE = 'templates/Bank Letter.docx';

    /** @var array<int, string> */
    private const MONTH_NAMES = [
        1 => 'January',
        2 => 'February',
        3 => 'March',
        4 => 'April',
        5 => 'May',
        6 => 'June',
        7 => 'July',
        8 => 'August',
        9 => 'September',
        10 => 'October',
        11 => 'November',
        12 => 'December',
    ];

    /** @var array<int, string> */
    private const SHORT_MONTHS = [
        1 => 'Jan',
        2 => 'Feb',
        3 => 'Mar',
        4 => 'Apr',
        5 => 'May',
        6 => 'Jun',
        7 => 'Jul',
        8 => 'Aug',
        9 => 'Sep',
        10 => 'Oct',
        11 => 'Nov',
        12 => 'Dec',
    ];

    public function templatePath(): string
    {
        return $this->storageAppPath(self::TEMPLATE_RELATIVE);
    }

    public function letterDateNow(): string
    {
        $tz = 'Asia/Kolkata';
        try {
            if (function_exists('app') && app()->bound('config')) {
                $configured = config('app.timezone');
                if (is_string($configured) && $configured !== '') {
                    $tz = $configured;
                }
            }
        } catch (\Throwable) {
            // Unit tests may run without a full Laravel application.
        }

        return Carbon::now($tz)->format('d/m/Y');
    }

    public function salaryMonthLabel(int $month, int $year): string
    {
        if ($month < 1 || $month > 12) {
            throw new InvalidArgumentException('Invalid payroll month.');
        }

        return self::MONTH_NAMES[$month].' '.$year;
    }

    public function downloadFilename(int $month, int $year): string
    {
        if ($month < 1 || $month > 12) {
            throw new InvalidArgumentException('Invalid payroll month.');
        }

        return 'Bank Letter '.self::SHORT_MONTHS[$month].' '.$year.'.docx';
    }

    /** Indian grouping with 2 decimal places, e.g. 21,39,931.00 */
    public function formatAmount(float|int|string $amount): string
    {
        $n = round((float) $amount, 2);
        $negative = $n < 0;
        $n = abs($n);
        $parts = explode('.', number_format($n, 2, '.', ''));
        $int = $parts[0];
        $dec = $parts[1] ?? '00';
        $last3 = substr($int, -3);
        $rest = substr($int, 0, -3);
        if ($rest !== '' && $rest !== false) {
            $rest = preg_replace('/\B(?=(\d{2})+(?!\d))/', ',', $rest);
            $int = $rest.','.$last3;
        } else {
            $int = $last3;
        }

        return ($negative ? '-' : '').$int.'.'.$dec;
    }

    /**
     * Normalize and validate employee rows for the bank letter.
     *
     * @param  array<int, array<string, mixed>>  $employees
     * @return array{rows: list<array{employee_user_id: string, employee_code: string, employee_name: string, account_number: string, amount: float}>, total: float}
     */
    public function normalizeEmployees(
        string $companyId,
        array $employees,
        ?int $expectedCount = null,
        bool $skipCompanyCheck = false,
    ): array {
        if ($employees === []) {
            throw new InvalidArgumentException('Bank letter cannot be generated. No employees were provided.');
        }

        if ($expectedCount !== null && count($employees) !== $expectedCount) {
            throw new InvalidArgumentException('Employee count does not match the payroll run.');
        }

        $normalized = [];
        $seen = [];
        $missingAccount = [];
        $missingCode = [];
        $missingName = [];
        $missingAmount = [];
        $invalidAmount = [];
        $userIds = [];

        foreach ($employees as $index => $row) {
            if (! is_array($row)) {
                throw new InvalidArgumentException('Invalid employee row at index '.$index.'.');
            }

            $uid = trim((string) ($row['employeeUserId'] ?? $row['employee_user_id'] ?? ''));
            $code = trim((string) ($row['employeeCode'] ?? $row['employee_code'] ?? ''));
            $name = trim((string) ($row['employeeName'] ?? $row['employee_name'] ?? ''));
            $account = $this->accountAsText(
                $row['bankAccountNumber'] ?? $row['bank_account_number'] ?? $row['accountNumber'] ?? $row['account_number'] ?? null
            );

            $amountRaw = $row['netPay']
                ?? $row['net_pay']
                ?? $row['amount']
                ?? null;
            if ($amountRaw === null && is_array($row['governmentMonthly'] ?? null)) {
                $gm = $row['governmentMonthly'];
                $amountRaw = $gm['netSalary'] ?? $gm['net_salary'] ?? null;
            }
            if ($amountRaw === null && is_array($row['government_monthly'] ?? null)) {
                $gm = $row['government_monthly'];
                $amountRaw = $gm['netSalary'] ?? $gm['net_salary'] ?? null;
            }

            if ($uid === '') {
                throw new InvalidArgumentException('Each employee must include employee_user_id.');
            }
            if (isset($seen[$uid])) {
                throw new InvalidArgumentException('Duplicate employee_user_id in bank letter request.');
            }
            $seen[$uid] = true;
            $userIds[] = $uid;

            if ($code === '') {
                $missingCode[] = $name !== '' ? $name : $uid;
            }
            if ($name === '') {
                $missingName[] = $code !== '' ? $code : $uid;
            }
            if ($account === '') {
                $missingAccount[] = $name !== '' ? $name : ($code !== '' ? $code : $uid);
            }

            if ($amountRaw === null || $amountRaw === '') {
                $missingAmount[] = $name !== '' ? $name : ($code !== '' ? $code : $uid);
                $amount = null;
            } else {
                $amount = round((float) $amountRaw, 2);
                if (! is_finite($amount) || $amount < 0) {
                    $invalidAmount[] = $name !== '' ? $name : $uid;
                }
            }

            $normalized[] = [
                'employee_user_id' => $uid,
                'employee_code' => $code,
                'employee_name' => $name,
                'account_number' => $account,
                'amount' => $amount ?? 0.0,
            ];
        }

        if ($missingAccount !== []) {
            throw new InvalidArgumentException(
                'Bank letter cannot be generated. Missing account number for: '.implode(', ', $missingAccount).'.'
            );
        }
        if ($missingCode !== []) {
            throw new InvalidArgumentException(
                'Bank letter cannot be generated. Missing employee ID for: '.implode(', ', $missingCode).'.'
            );
        }
        if ($missingName !== []) {
            throw new InvalidArgumentException(
                'Bank letter cannot be generated. Missing employee name for: '.implode(', ', $missingName).'.'
            );
        }
        if ($missingAmount !== []) {
            throw new InvalidArgumentException(
                'Bank letter cannot be generated. Missing net salary for: '.implode(', ', $missingAmount).'.'
            );
        }
        if ($invalidAmount !== []) {
            throw new InvalidArgumentException(
                'Bank letter cannot be generated. Invalid net salary for: '.implode(', ', $invalidAmount).'.'
            );
        }

        if (! $skipCompanyCheck) {
            $this->assertEmployeesBelongToCompany($companyId, $userIds);
        }

        $total = 0.0;
        foreach ($normalized as $row) {
            $total += $row['amount'];
        }

        return [
            'rows' => $normalized,
            'total' => round($total, 2),
        ];
    }

    /**
     * @param  list<string>  $userIds
     */
    public function assertEmployeesBelongToCompany(string $companyId, array $userIds): void
    {
        $unique = array_values(array_unique($userIds));
        $found = HrmsUser::query()
            ->where('company_id', $companyId)
            ->whereIn('id', $unique)
            ->pluck('id')
            ->map(fn ($id) => (string) $id)
            ->all();

        $foundSet = array_fill_keys($found, true);
        $missing = [];
        foreach ($unique as $uid) {
            if (! isset($foundSet[$uid])) {
                $inMaster = HrmsPayrollMaster::query()
                    ->where('company_id', $companyId)
                    ->where(function ($q) use ($uid) {
                        $q->where('employee_user_id', $uid)->orWhere('user_id', $uid);
                    })
                    ->exists();
                if (! $inMaster) {
                    $missing[] = $uid;
                }
            }
        }

        if ($missing !== []) {
            throw new InvalidArgumentException('One or more employees do not belong to this company.');
        }
    }

    /**
     * @param  list<array{employee_user_id: string, employee_code: string, employee_name: string, account_number: string, amount: float}>  $rows
     */
    public function generateDownloadResponse(
        int $month,
        int $year,
        array $rows,
        float $total,
        ?string $letterDate = null,
    ): BinaryFileResponse {
        $path = $this->generateToTempFile($month, $year, $rows, $total, $letterDate);
        $filename = $this->downloadFilename($month, $year);

        return response()
            ->download(
                $path,
                $filename,
                [
                    'Content-Type' => 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                ]
            )
            ->deleteFileAfterSend(true);
    }

    /**
     * @param  list<array{employee_user_id: string, employee_code: string, employee_name: string, account_number: string, amount: float}>  $rows
     */
    public function generateToTempFile(
        int $month,
        int $year,
        array $rows,
        float $total,
        ?string $letterDate = null,
    ): string {
        $template = $this->templatePath();
        if (! is_file($template)) {
            throw new InvalidArgumentException('Bank letter template is not available.');
        }

        $tmpDir = $this->storageAppPath('tmp');
        if (! is_dir($tmpDir)) {
            mkdir($tmpDir, 0755, true);
        }

        $safeName = 'bank-letter-'.bin2hex(random_bytes(8)).'.docx';
        $tmpPath = $tmpDir.DIRECTORY_SEPARATOR.$safeName;

        $processor = new TemplateProcessor($template);
        $processor->setValue('letter_date', $letterDate ?? $this->letterDateNow());
        $processor->setValue('salary_month', $this->salaryMonthLabel($month, $year));
        $processor->setValue('total_amount', $this->formatAmount($total));

        $count = count($rows);
        $processor->cloneRow('sr_no', $count);

        foreach ($rows as $i => $row) {
            $n = $i + 1;
            $processor->setValue('sr_no#'.$n, (string) $n);
            $processor->setValue('employee_code#'.$n, $row['employee_code']);
            $processor->setValue('employee_name#'.$n, $row['employee_name']);
            // Always set as string — preserve leading zeros; never cast to int/float.
            $processor->setValue('account_number#'.$n, (string) $row['account_number']);
            $processor->setValue('amount#'.$n, $this->formatAmount($row['amount']));
        }

        $processor->saveAs($tmpPath);

        return $tmpPath;
    }

    private function storageAppPath(string $relative): string
    {
        $relative = ltrim(str_replace(['..', '\\'], ['', '/'], $relative), '/');
        try {
            if (function_exists('storage_path')) {
                $path = storage_path('app/'.$relative);
                if (is_string($path) && $path !== '') {
                    return $path;
                }
            }
        } catch (\Throwable) {
            // Fall through for unit tests without Laravel path helpers.
        }

        return dirname(__DIR__, 2).DIRECTORY_SEPARATOR.'storage'.DIRECTORY_SEPARATOR.'app'.DIRECTORY_SEPARATOR.str_replace('/', DIRECTORY_SEPARATOR, $relative);
    }

    private function accountAsText(mixed $value): string
    {
        if ($value === null) {
            return '';
        }
        if (is_int($value) || is_float($value)) {
            return preg_replace('/\D+/', '', (string) $value) ?? '';
        }
        $s = trim((string) $value);

        return preg_replace('/\s+/', '', $s) ?? '';
    }
}
