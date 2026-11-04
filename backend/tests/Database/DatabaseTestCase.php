<?php

namespace Tests\Database;

use Illuminate\Contracts\Console\Kernel;
use Illuminate\Foundation\Application;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use PHPUnit\Framework\TestCase;
use Tests\Support\TestWorld;

/**
 * Boots the Laravel app against the LOCAL development database and wraps every
 * test in a transaction that is always rolled back, so nothing is persisted.
 * Refuses to run against a non-local host. Skips when the database is down.
 */
abstract class DatabaseTestCase extends TestCase
{
    protected Application $app;

    /** Known synthetic fixtures, created fresh inside this test's transaction (see tests/Support/TestWorld.php). */
    protected TestWorld $world;

    private static ?Application $booted = null;

    /** Boot once per class (outside any test) so PHPUnit does not flag Laravel's error handlers. */
    public static function setUpBeforeClass(): void
    {
        parent::setUpBeforeClass();
        if (self::$booted === null) {
            self::$booted = require dirname(__DIR__, 2).'/bootstrap/app.php';
            self::$booted->make(Kernel::class)->bootstrap();
        }
    }

    protected function setUp(): void
    {
        parent::setUp();
        $this->app = self::$booted;

        // Hard stop: the suite may only touch a database whose name ends in _test (cirt_payroll_test), never hrms.
        $database = (string) config('database.connections.'.config('database.default').'.database');
        if (! str_ends_with($database, '_test') && ! str_ends_with($database, '_clientcopy')) {
            $this->fail("Refusing to run database tests against '{$database}': the test database must be named *_test (see phpunit.xml).");
        }
        $host = (string) config('database.connections.'.config('database.default').'.host');
        if (! in_array($host, ['127.0.0.1', 'localhost', '::1'], true)) {
            $this->fail("Refusing to run database tests against non-local host '{$host}'.");
        }
        try {
            DB::connection()->getPdo();
        } catch (\Throwable $e) {
            $this->markTestSkipped('Local database unavailable: '.$e->getMessage());
        }
        // The cache (in-memory under phpunit) must not remember a company id from a previous, rolled-back test.
        Cache::flush();
        DB::beginTransaction();
        $this->world = TestWorld::seed();
    }

    protected function tearDown(): void
    {
        while (DB::transactionLevel() > 0) {
            DB::rollBack();
        }
        parent::tearDown();
    }

    /** @return array{company: string, users: list<string>} employees that have a current Payroll Master */
    protected function sampleEmployees(int $count = 2): array
    {
        $masters = DB::table('cirt_payroll_master')
            ->whereNull('effective_to')->where('status', 'active')->whereNotNull('employee_user_id')
            ->orderBy('employee_code')->limit($count)->get(['company_id', 'employee_user_id']);
        if ($masters->count() < $count) {
            $this->markTestSkipped('Local database has no payroll masters to test with.');
        }

        return ['company' => (string) $masters[0]->company_id, 'users' => $masters->pluck('employee_user_id')->map('strval')->all()];
    }
}
