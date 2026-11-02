<?php

namespace Tests\Unit;

use PHPUnit\Framework\TestCase;

/**
 * Guard: a class reference whose namespace separators were lost (e.g. "AppSupportPayrollTotals::x")
 * still passes `php -l` but is a fatal error the first time that line runs.
 */
final class NoStrippedNamespaceTest extends TestCase
{
    public function test_no_class_reference_has_lost_its_namespace_separators(): void
    {
        $bad = [];
        $roots = [dirname(__DIR__, 2).'/app', dirname(__DIR__, 2).'/routes', dirname(__DIR__, 2).'/database'];
        foreach ($roots as $root) {
            $it = new \RecursiveIteratorIterator(new \RecursiveDirectoryIterator($root, \FilesystemIterator::SKIP_DOTS));
            foreach ($it as $file) {
                if ($file->getExtension() !== 'php') continue;
                $source = (string) file_get_contents($file->getPathname());
                if (preg_match('/(?<![\\\\\w])(?:App(?:Support|Models|Services|Http)|Illuminate(?:Support|Database|Http))[A-Z]\w*(?:::|\s*\()/', $source, $m)) {
                    $bad[] = $file->getPathname().' => '.$m[0];
                }
            }
        }
        $this->assertSame([], $bad);
    }
}
