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

    public function test_level_1_2_enhanced_when_basic_at_or_above_threshold(): void
    {
        $this->assertSame(1350.0, $this->service->getTransportBaseByPayLevel(2, 20000));
        $this->assertSame(1350.0, $this->service->getTransportBaseByPayLevel(2, 24199));
        $this->assertSame(3600.0, $this->service->getTransportBaseByPayLevel(2, 24200));
        $this->assertSame(3600.0, $this->service->getTransportBaseByPayLevel(1, 25000));
        $this->assertSame('LEVEL_1_2_ENHANCED', $this->service->deriveTransportSlab(2, 24200)['group']);
    }

    public function test_transport_settings_override_defaults(): void
    {
        $config = [
            'level_9_plus' => 8000,
            'level_3_8' => 4000,
            'level_1_2' => 1500,
            'level_1_2_enhanced' => 4100,
            'basic_threshold' => 30000,
            'high_min_level' => 10,
            'mid_min_level' => 4,
        ];
        $this->assertSame(8000.0, $this->service->getTransportBaseByPayLevel(10, 0, $config));
        $this->assertSame(4000.0, $this->service->getTransportBaseByPayLevel(9, 0, $config)); // mid (4–9)
        $this->assertSame(4000.0, $this->service->getTransportBaseByPayLevel(5, 0, $config));
        $this->assertSame(1500.0, $this->service->getTransportBaseByPayLevel(3, 29999, $config)); // low
        $this->assertSame(4100.0, $this->service->getTransportBaseByPayLevel(2, 30000, $config));
    }

    public function test_configurable_level_bands(): void
    {
        $config = [
            'high_min_level' => 7,
            'mid_min_level' => 4,
        ];
        $this->assertSame(7200.0, $this->service->getTransportBaseByPayLevel(7, 0, $config));
        $this->assertSame(3600.0, $this->service->getTransportBaseByPayLevel(6, 0, $config));
        $this->assertSame(1350.0, $this->service->getTransportBaseByPayLevel(3, 0, $config));
    }

    public function test_da_on_transport_uses_dynamic_da_percent(): void
    {
        $calc = $this->service->calculateMaster([
            'pay_level' => 9,
            'gross_basic_pay' => 100000,
            'da_percent' => 60,
        ]);

        $this->assertSame(7200.0, $calc['transport_base']);
        $this->assertSame(4320.0, $calc['transport_da']);
        $this->assertSame(11520.0, $calc['transport_total']);
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

    public function test_explicit_zero_transport_total_is_persisted(): void
    {
        $calc = $this->service->calculateMaster([
            'pay_level' => 8,
            'gross_basic_pay' => 83600,
            'da_percent' => 60,
            'hra_percent' => 30,
            'medical' => 3000,
            'transport_total' => 0,
        ]);

        $this->assertSame(0.0, $calc['transport_total']);
        // Slab would have been 5760 — must not replace explicit 0.
        $this->assertNotSame(5760.0, $calc['transport_total']);
    }

    public function test_explicit_custom_transport_total_is_persisted(): void
    {
        $calc = $this->service->calculateMaster([
            'pay_level' => 8,
            'gross_basic_pay' => 83600,
            'da_percent' => 60,
            'transport_total' => 500,
        ]);

        $this->assertSame(500.0, $calc['transport_total']);
    }
}
