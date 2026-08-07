<?php

namespace Tests\Unit;

use App\Http\Controllers\Api\V1\PayrollBankLetterController;
use App\Services\PayrollBankLetterService;
use InvalidArgumentException;
use PhpOffice\PhpWord\IOFactory;
use PhpOffice\PhpWord\Element\Table;
use PhpOffice\PhpWord\Element\TextRun;
use PHPUnit\Framework\TestCase;

final class PayrollBankLetterServiceTest extends TestCase
{
    private PayrollBankLetterService $service;

    protected function setUp(): void
    {
        parent::setUp();
        $this->service = new PayrollBankLetterService;
    }

    public function test_classes_and_route_registered(): void
    {
        $this->assertTrue(class_exists(PayrollBankLetterService::class));
        $this->assertTrue(class_exists(PayrollBankLetterController::class));
        $routes = file_get_contents(dirname(__DIR__, 2).'/routes/api.php');
        $this->assertIsString($routes);
        $this->assertStringContainsString('payroll/bank-letter', $routes);
        $this->assertStringContainsString('PayrollBankLetterController', $routes);
        $controller = file_get_contents(dirname(__DIR__, 2).'/app/Http/Controllers/Api/V1/PayrollBankLetterController.php');
        $this->assertIsString($controller);
        $this->assertStringContainsString('Forbidden', $controller);
        $this->assertStringContainsString('UserRole::Admin', $controller);
    }

    public function test_template_exists_with_placeholders(): void
    {
        $path = $this->service->templatePath();
        $this->assertFileExists($path);

        $zip = new \ZipArchive;
        $this->assertTrue($zip->open($path));
        $xml = $zip->getFromName('word/document.xml');
        $zip->close();
        $this->assertIsString($xml);
        foreach (['letter_date', 'salary_month', 'total_amount', 'sr_no', 'employee_code', 'employee_name', 'account_number', 'amount'] as $ph) {
            $this->assertStringContainsString('${'.$ph.'}', $xml);
        }
        foreach (['ABC', 'LMN', 'PQR', 'XYZ'] as $sample) {
            $this->assertStringNotContainsString($sample, $xml);
        }
    }

    public function test_filename_and_salary_month(): void
    {
        $this->assertSame('Bank Letter Sep 2026.docx', $this->service->downloadFilename(9, 2026));
        $this->assertSame('September 2026', $this->service->salaryMonthLabel(9, 2026));
        $this->assertMatchesRegularExpression('/^\d{2}\/\d{2}\/\d{4}$/', $this->service->letterDateNow());
    }

    public function test_format_amount_indian_grouping(): void
    {
        $this->assertSame('1,27,858.00', $this->service->formatAmount(127858));
        $this->assertSame('21,39,931.00', $this->service->formatAmount(2139931));
        $this->assertSame('0.00', $this->service->formatAmount(0));
    }

    public function test_missing_account_number_rejected(): void
    {
        $this->expectException(InvalidArgumentException::class);
        $this->expectExceptionMessage('Missing account number');
        $this->service->normalizeEmployees('co-1', [
            [
                'employeeUserId' => 'u1',
                'employeeCode' => 'E1',
                'employeeName' => 'Rohan Mehta',
                'bankAccountNumber' => '',
                'netPay' => 1000,
            ],
            [
                'employeeUserId' => 'u2',
                'employeeCode' => 'E2',
                'employeeName' => 'Devang Shah',
                'bankAccountNumber' => null,
                'netPay' => 2000,
            ],
        ], 2, true);
    }

    public function test_employee_count_mismatch_rejected(): void
    {
        $this->expectException(InvalidArgumentException::class);
        $this->expectExceptionMessage('Employee count does not match');
        $this->service->normalizeEmployees('co-1', [
            [
                'employeeUserId' => 'u1',
                'employeeCode' => 'E1',
                'employeeName' => 'A',
                'bankAccountNumber' => '001',
                'netPay' => 100,
            ],
        ], 2, true);
    }

    public function test_all_employees_included_and_total(): void
    {
        $emps = [];
        for ($i = 1; $i <= 15; $i++) {
            $emps[] = [
                'employeeUserId' => 'u'.$i,
                'employeeCode' => 'C'.$i,
                'employeeName' => 'Name '.$i,
                'bankAccountNumber' => str_pad((string) $i, 12, '0', STR_PAD_LEFT),
                'netPay' => 1000 + $i,
            ];
        }
        $result = $this->service->normalizeEmployees('co-1', $emps, 15, true);
        $this->assertCount(15, $result['rows']);
        $expectedTotal = array_sum(array_map(fn ($e) => $e['netPay'], $emps));
        $this->assertSame(round($expectedTotal, 2), $result['total']);
        $this->assertSame('000000000012', $result['rows'][11]['account_number']);
    }

    public function test_docx_generation_removes_samples_and_fills_fields(): void
    {
        $rows = [];
        for ($i = 1; $i <= 6; $i++) {
            $rows[] = [
                'employee_user_id' => 'u'.$i,
                'employee_code' => 'E'.$i,
                'employee_name' => 'Employee '.$i,
                'account_number' => '00112233445'.$i,
                'amount' => 10000.0 * $i,
            ];
        }
        $total = array_sum(array_column($rows, 'amount'));
        $path = $this->service->generateToTempFile(9, 2026, $rows, $total, '06/08/2026');
        $this->assertFileExists($path);

        $phpWord = IOFactory::load($path);
        $flat = [];
        foreach ($phpWord->getSections() as $section) {
            foreach ($section->getElements() as $el) {
                if (! ($el instanceof Table)) {
                    continue;
                }
                foreach ($el->getRows() as $row) {
                    $cells = [];
                    foreach ($row->getCells() as $cell) {
                        $txt = '';
                        foreach ($cell->getElements() as $ce) {
                            if ($ce instanceof TextRun) {
                                foreach ($ce->getElements() as $t) {
                                    if (method_exists($t, 'getText')) {
                                        $txt .= $t->getText();
                                    }
                                }
                            } elseif (method_exists($ce, 'getText')) {
                                $txt .= $ce->getText();
                            }
                        }
                        $cells[] = trim($txt);
                    }
                    $flat[] = $cells;
                }
            }
        }

        $joined = json_encode($flat, JSON_UNESCAPED_UNICODE);
        $this->assertIsString($joined);
        $dateFound = false;
        foreach ($flat as $cells) {
            foreach ($cells as $cell) {
                if (str_contains((string) $cell, '06/08/2026')) {
                    $dateFound = true;
                }
            }
        }
        $this->assertTrue($dateFound, 'letter date should be inserted');
        $this->assertStringContainsString('September 2026', $joined);
        $this->assertStringContainsString('Employee 6', $joined);
        $this->assertStringContainsString('001122334456', $joined);
        $this->assertStringContainsString($this->service->formatAmount($total), $joined);
        $this->assertStringNotContainsString('ABC', $joined);
        $this->assertStringNotContainsString('LMN', $joined);
        $this->assertStringNotContainsString('${', $joined);

        $hasTotal = false;
        foreach ($flat as $cells) {
            if (in_array('TOTAL', $cells, true)) {
                $hasTotal = true;
                $this->assertContains($this->service->formatAmount($total), $cells);
            }
        }
        $this->assertTrue($hasTotal);

        @unlink($path);
        $this->assertFileDoesNotExist($path);
    }

    public function test_content_type_and_admin_gate_documented(): void
    {
        $controller = file_get_contents(dirname(__DIR__, 2).'/app/Http/Controllers/Api/V1/PayrollBankLetterController.php');
        $this->assertIsString($controller);
        $this->assertStringContainsString(
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            file_get_contents(dirname(__DIR__, 2).'/app/Services/PayrollBankLetterService.php') ?: ''
        );
        $this->assertStringContainsString('deleteFileAfterSend', file_get_contents(dirname(__DIR__, 2).'/app/Services/PayrollBankLetterService.php') ?: '');
    }
}
