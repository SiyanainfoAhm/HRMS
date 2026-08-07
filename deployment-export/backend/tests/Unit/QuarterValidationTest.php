<?php

namespace Tests\Unit;

use App\Services\QuarterService;
use App\Services\QuarterTypeService;
use PHPUnit\Framework\TestCase;
use ReflectionClass;

final class QuarterValidationTest extends TestCase
{
    public function test_alphanumeric_quarter_names_are_accepted(): void
    {
        $service = $this->quarterServiceWithoutCtor();
        $method = (new ReflectionClass($service))->getMethod('assertValidQuarterName');
        $method->setAccessible(true);

        foreach (['B2/7', 'A-12', 'C1', 'B/14', 'QTR 23-A', 'Type-II (New)', 'D.12'] as $name) {
            try {
                $method->invoke($service, $name);
                $this->assertTrue(true);
            } catch (\Throwable $e) {
                $this->fail("Expected valid name {$name}, got: ".$e->getMessage());
            }
        }
    }

    public function test_symbol_only_quarter_name_rejected(): void
    {
        $service = $this->quarterServiceWithoutCtor();
        $method = (new ReflectionClass($service))->getMethod('assertValidQuarterName');
        $method->setAccessible(true);

        try {
            $method->invoke($service, '---');
            $this->fail('Expected rejection for symbol-only name');
        } catch (\Throwable $e) {
            $this->assertTrue(
                str_contains($e->getMessage(), 'letter or number')
                || str_contains($e->getMessage(), 'facade root')
                || str_contains($e->getMessage(), 'Quarter Number'),
                $e->getMessage(),
            );
        }
    }

    public function test_quarter_name_normalization_collapses_spaces(): void
    {
        $service = $this->quarterServiceWithoutCtor();
        $this->assertSame('B2/7', $service->normalizeQuarterName('  B2/7  '));
        $this->assertSame('QTR 23-A', $service->normalizeQuarterName('QTR   23-A'));
    }

    public function test_quarter_type_name_validation(): void
    {
        $types = new QuarterTypeService;
        try {
            $types->assertValidTypeName('Special Type A');
            $types->assertValidTypeName('Type V');
        } catch (\Throwable $e) {
            $this->fail('Expected valid type names, got: '.$e->getMessage());
        }

        try {
            $types->assertValidTypeName('@@@');
            $this->fail('Expected rejection for symbol-only type');
        } catch (\Throwable $e) {
            $this->assertTrue(
                str_contains($e->getMessage(), 'letter or number')
                || str_contains($e->getMessage(), 'facade root')
                || str_contains($e->getMessage(), 'Quarter Type'),
                $e->getMessage(),
            );
        }
    }

    public function test_quarter_type_duplicate_normalization_key(): void
    {
        $types = new QuarterTypeService;
        $this->assertSame('special type a', $types->normalizeKey('  Special   Type A '));
        $this->assertSame($types->normalizeKey('Type II'), $types->normalizeKey('type ii'));
    }

    public function test_quarter_type_routes_registered(): void
    {
        $routes = file_get_contents(dirname(__DIR__, 2).'/routes/api.php');
        $this->assertIsString($routes);
        $this->assertStringContainsString('settings/quarter-types', $routes);
        $this->assertStringContainsString('QuarterTypeController', $routes);
    }

    public function test_quarter_types_migration_exists(): void
    {
        $path = dirname(__DIR__, 2).'/database/migrations/2026_08_06_120000_create_cirt_quarter_types.php';
        $this->assertFileExists($path);
        $source = file_get_contents($path);
        $this->assertIsString($source);
        $this->assertStringContainsString('cirt_quarter_types', $source);
        $this->assertStringContainsString('quarter_type_id', $source);
    }

    private function quarterServiceWithoutCtor(): QuarterService
    {
        $ref = new ReflectionClass(QuarterService::class);

        return $ref->newInstanceWithoutConstructor();
    }
}
