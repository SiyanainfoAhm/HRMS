<?php

/**
 * One-shot: prepare Bank Letter.docx with TemplateProcessor placeholders.
 * Run from backend/: php scripts/prepare_bank_letter_template.php
 */

$root = dirname(__DIR__);
$src = $root . '/storage/app/templates/Bank Letter.original.docx';
$dest = $root . '/storage/app/templates/Bank Letter.docx';

if (!is_file($src)) {
    fwrite(STDERR, "Missing original: {$src}\n");
    exit(1);
}

$tmp = sys_get_temp_dir() . '/bank_letter_prep_' . uniqid();
mkdir($tmp);
$zip = new ZipArchive();
if ($zip->open($src) !== true) {
    fwrite(STDERR, "Cannot open {$src}\n");
    exit(1);
}
$zip->extractTo($tmp);
$zip->close();

$xmlPath = $tmp . '/word/document.xml';
$xml = file_get_contents($xmlPath);
if ($xml === false) {
    fwrite(STDERR, "Cannot read document.xml\n");
    exit(1);
}

// Simple text replacements (values appear as contiguous runs in this template).
$replacements = [
    'DATE:' => 'DATE: ${letter_date}',
    'for the month of ____________________.' => 'for the month of ${salary_month}.',
];

foreach ($replacements as $from => $to) {
    if (!str_contains($xml, $from)) {
        fwrite(STDERR, "WARNING: pattern not found: {$from}\n");
    } else {
        $xml = str_replace($from, $to, $xml);
    }
}

// "For Rs." is split across Word runs in the original template.
$fromRs = '<w:t>Rs._</w:t>';
$toRs = '<w:t>Rs.${total_amount}</w:t>';
$fromRsTail = '<w:t xml:space="preserve">____ /- drawn in your favour with a request </w:t>';
$toRsTail = '<w:t xml:space="preserve"> /- drawn in your favour with a request </w:t>';
if (str_contains($xml, $fromRs) && str_contains($xml, $fromRsTail)) {
    $xml = str_replace($fromRs, $toRs, $xml);
    $xml = str_replace($fromRsTail, $toRsTail, $xml);
} else {
    fwrite(STDERR, "WARNING: For Rs amount runs not found\n");
}

/**
 * Replace first occurrence of a whole-cell simple text run content.
 * Sample rows use plain <w:t>NAME</w:t> style text.
 */
function replaceFirst(string $haystack, string $needle, string $replace): string
{
    $pos = strpos($haystack, $needle);
    if ($pos === false) {
        throw new RuntimeException("Needle not found: {$needle}");
    }

    return substr_replace($haystack, $replace, $pos, strlen($needle));
}

// Template employee row: first sample "ABC" row becomes placeholders.
// Order matters: replace unique sample names/amounts carefully.
$xml = replaceFirst($xml, '>ABC<', '>${employee_name}<');
// First data row SRNO "1" after header — replace carefully after header SRNO text stays.
// Find employee row markers: after "Account Number" header block, first "1" in SRNO column.
// Safer: replace the four sample names and leave serials via cloneRow.

$xml = replaceFirst($xml, '>LMN<', '>${_remove_lmn}<');
$xml = replaceFirst($xml, '>PQR<', '>${_remove_pqr}<');
$xml = replaceFirst($xml, '>XYZ<', '>${_remove_xyz}<');

// First employee row serial and empty cells: after converting ABC row,
// set placeholders for employee_code, account_number, amount, sr_no.
// The ABC row currently has: SRNO=1, Employee ID=nbsp, NAME=placeholder, Account=nbsp, AMOUNT=nbsp

// Replace TOTAL amount cell value "0" that follows TOTAL — last >0< before end of that row is fragile.
// Replace the TOTAL row amount: look for >TOTAL< nearby and then amount.
if (!preg_match('/(>TOTAL<.*?>(?:0| )<)/s', $xml)) {
    // try with TOTAL then later 0
}

// Put placeholders into the first employee data row by replacing the first standalone serial "1"
// that appears in a table cell after the header. Use unique markers around ABC row.

// After NAME placeholder, set adjacent empty cells in that row:
// Structure for row with ABC was: 1 | nbsp | ABC | nbsp | nbsp
// Replace first occurrence of serial 1 in data (the one before employee_name).
$marker = '${employee_name}';
$posName = strpos($xml, $marker);
if ($posName === false) {
    fwrite(STDERR, "employee_name placeholder missing\n");
    exit(1);
}

// Walk backwards from name to find the SRNO cell text "1"
$before = substr($xml, 0, $posName);
// Replace the last >1< before employee_name (SRNO)
if (!preg_match('/^(.*)>(1)<(\s*<\/w:t>.*)$/s', $before, $m)) {
    // try with more context
    $before2 = $before;
    $idx = strrpos($before2, '>1<');
    if ($idx === false) {
        fwrite(STDERR, "Could not find SRNO 1 before employee name\n");
        exit(1);
    }
    $before = substr($before2, 0, $idx) . '>${sr_no}<' . substr($before2, $idx + 3);
} else {
    $before = $m[1] . '>${sr_no}<' . $m[3];
}

$after = substr($xml, $posName);
// In the ABC row, Employee ID cell is before NAME — replace last nbsp before name with employee_code
$idxNbsp = strrpos($before, '> <');
if ($idxNbsp === false) {
    $idxNbsp = strrpos($before, '>' . "\xC2\xA0" . '<');
}
if ($idxNbsp !== false) {
    $before = substr($before, 0, $idxNbsp) . '>${employee_code}<' . substr($before, $idxNbsp + strlen('> <'));
}

// After name: two nbsp cells → account_number, amount
$count = 0;
$after = preg_replace_callback('/> </u', function ($m) use (&$count) {
    $count++;
    if ($count === 1) {
        return '>${account_number}<';
    }
    if ($count === 2) {
        return '>${amount}<';
    }

    return $m[0];
}, $after, 2);

$xml = $before . $after;

// TOTAL amount: replace the 0 that is the amount on TOTAL row.
// Prefer replacing `>TOTAL<` ... next numeric/zero in same general area.
if (preg_match('/(>TOTAL<\/w:t>)/', $xml, $tm, PREG_OFFSET_CAPTURE)) {
    $start = $tm[0][1];
    $chunk = substr($xml, $start, 2500);
    $chunk2 = preg_replace('/>(0)</', '>${total_amount}<', $chunk, 1, $n);
    if ($n === 1) {
        $xml = substr($xml, 0, $start) . $chunk2 . substr($xml, $start + strlen($chunk));
    } else {
        fwrite(STDERR, "WARNING: TOTAL amount 0 not replaced\n");
    }
}

file_put_contents($xmlPath, $xml);

// Remove sample rows containing remove markers and the blank 5th employee row.
// Delete entire <w:tr>...</w:tr> that contain those markers.
$dom = new DOMDocument();
$dom->preserveWhiteSpace = true;
$prev = libxml_use_internal_errors(true);
$dom->loadXML($xml);
libxml_clear_errors();
libxml_use_internal_errors($prev);

$xpath = new DOMXPath($dom);
$xpath->registerNamespace('w', 'http://schemas.openxmlformats.org/wordprocessingml/2006/main');

$rows = [];
foreach ($xpath->query('//w:tr') as $tr) {
    $rows[] = $tr;
}

$toRemove = [];
foreach ($rows as $tr) {
    $text = $tr->textContent;
    if (str_contains($text, '_remove_lmn')
        || str_contains($text, '_remove_pqr')
        || str_contains($text, '_remove_xyz')
    ) {
        $toRemove[] = $tr;
        continue;
    }
    // Blank employee row: serial "5" with empty name (no placeholders, no TOTAL)
    $normalized = preg_replace('/\s+/u', '', $text);
    if ($normalized === '5' || $normalized === '5' . "\xC2\xA0" . "\xC2\xA0" . "\xC2\xA0") {
        // may include nbsp
    }
    if (preg_match('/^5[\x{00A0}\s]*$/u', $text) || (str_contains($text, '5') && !str_contains($text, 'TOTAL') && !str_contains($text, '${') && !preg_match('/[A-Za-z]/', preg_replace('/[\x{00A0}\s]/u', '', $text)))) {
        // Check it's the blank 5th data row: text is mostly 5 and nbsp
        $letters = preg_replace('/[^A-Za-z]/', '', $text);
        $digits = preg_replace('/[^0-9]/', '', $text);
        if ($letters === '' && $digits === '5') {
            $toRemove[] = $tr;
        }
    }
}

foreach ($toRemove as $tr) {
    $tr->parentNode?->removeChild($tr);
}

$newXml = $dom->saveXML();
if ($newXml === false) {
    fwrite(STDERR, "Failed to save XML\n");
    exit(1);
}
file_put_contents($xmlPath, $newXml);

// Verify placeholders
$check = file_get_contents($xmlPath);
foreach (['${letter_date}', '${salary_month}', '${total_amount}', '${sr_no}', '${employee_code}', '${employee_name}', '${account_number}', '${amount}'] as $ph) {
    if (!str_contains($check, $ph)) {
        fwrite(STDERR, "MISSING placeholder: {$ph}\n");
        exit(1);
    }
}
if (str_contains($check, 'ABC') || str_contains($check, 'LMN') || str_contains($check, 'PQR') || str_contains($check, 'XYZ')) {
    fwrite(STDERR, "Sample names still present\n");
    exit(1);
}

$out = new ZipArchive();
if (is_file($dest)) {
    unlink($dest);
}
if ($out->open($dest, ZipArchive::CREATE) !== true) {
    fwrite(STDERR, "Cannot write {$dest}\n");
    exit(1);
}

$iterator = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($tmp));
foreach ($iterator as $file) {
    if ($file->isDir()) {
        continue;
    }
    $filePath = $file->getRealPath();
    $relative = substr($filePath, strlen($tmp) + 1);
    $relative = str_replace('\\', '/', $relative);
    $out->addFile($filePath, $relative);
}
$out->close();

// cleanup
$it = new RecursiveIteratorIterator(
    new RecursiveDirectoryIterator($tmp, FilesystemIterator::SKIP_DOTS),
    RecursiveIteratorIterator::CHILD_FIRST
);
foreach ($it as $f) {
    $f->isDir() ? rmdir($f->getPathname()) : unlink($f->getPathname());
}
rmdir($tmp);

echo "Prepared template: {$dest}\n";
