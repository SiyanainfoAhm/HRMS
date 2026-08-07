<?php

namespace Tests\Unit;

use App\Services\PayrollCalculationService;
use PHPUnit\Framework\TestCase;

final class PayrollTransportCalculationTest extends TestCase
{
    private PayrollCalculationService $service;

    protected function setUp(): void
    {
        parent::setUp();
        $this->service = new PayrollCalculationService();
    }

    public function test_transport_base_by_pay_level(): void
    {
        $this->assertSame(1350.0, $this->service->getTransportBaseByPayLevel(1));
        $this->assertSame(1350.0, $this->service->getTransportBaseByPayLevel(2));
        $this->assertSame(3600.0, $this->service->getTransportBaseByPayLevel(4));
        $this->assertSame(3600.0, $this->service->getTransportBaseByPayLevel(8));
        $this->assertSame(7200.0, $this->service->getTransportBaseByPayLevel(9));
        $this->assertSame(7200.0, $this->service->getTransportBaseByPayLevel(12));
    }

    public function test_pay_level_8_da_58_transport_total(): void
    {
        $calc = $this->service->calculateMaster([
            'pay_level' => 8,
            'gross_basic_pay' => 83600,
            'da_percent' => 58,
            'hra_percent' => 30,
            'medical' => 3000,
        ]);

        $this->assertSame(48488.0, $calc['da_amount']);
        $this->assertSame(3600.0, $calc['transport_base']);
        $this->assertSame(2088.0, $calc['transport_da']);
        $this->assertSame(5688.0, $calc['transport_total']);
        $this->assertSame(58.0, $calc['transport_da_percent']);
    }

    public function test_pay_level_8_da_60_transport_total(): void
    {
        $calc = $this->service->calculateMaster([
            'pay_level' => 8,
            'gross_basic_pay' => 83600,
            'da_percent' => 60,
        ]);

        $this->assertSame(3600.0, $calc['transport_base']);
        $this->assertSame(2160.0, $calc['transport_da']);
        $this->assertSame(5760.0, $calc['transport_total']);
    }

    public function test_pay_level_9_da_58_transport_total(): void
    {
        $calc = $this->service->calculateMaster([
            'pay_level' => 9,
            'gross_basic_pay' => 100000,
            'da_percent' => 58,
        ]);

        $this->assertSame(7200.0, $calc['transport_base']);
        $this->assertSame(4176.0, $calc['transport_da']);
        $this->assertSame(11376.0, $calc['transport_total']);
    }

    public function test_pay_level_2_da_58_transport_total(): void
    {
        $calc = $this->service->calculateMaster([
            'pay_level' => 2,
            'gross_basic_pay' => 20200,
            'da_percent' => 58,
        ]);

        $this->assertSame(1350.0, $calc['transport_base']);
        $this->assertSame(783.0, $calc['transport_da']);
        $this->assertSame(2133.0, $calc['transport_total']);
    }
}
