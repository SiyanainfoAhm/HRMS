<?php
declare(strict_types=1);
use PhpOffice\PhpSpreadsheet\IOFactory;
require __DIR__.'/../backend/vendor/autoload.php';
$dir=__DIR__.'/../data/imports/september-2026';
$files=glob($dir.'/*.xlsx');
// usage: php scripts/inspect-september-four-workbooks.php SURNAME [SURNAME ...]   (the names to look for in the workbooks under data/imports)
$need=array_map('strtoupper',array_slice($argv,1));
if($need===[]){fwrite(STDERR,"Give at least one surname to look for.".PHP_EOL);exit(1);}
$out=[];
foreach($files as $file){$book=IOFactory::load($file);foreach($book->getWorksheetIterator() as $sheet){$headers=[];foreach($sheet->getRowIterator(1,1)->current()->getCellIterator() as $c)$headers[$c->getColumn()]=trim((string)$c->getFormattedValue());$matches=[];for($r=2;$r<=$sheet->getHighestDataRow();$r++){ $values=[];foreach($headers as $col=>$head)$values[$head]=trim((string)$sheet->getCell($col.$r)->getFormattedValue());$text=strtoupper(implode(' ',$values));foreach($need as $n)if(str_contains($text,$n)){$matches[]=$values;break;}}$out[basename($file)][$sheet->getTitle()]=['headers'=>$headers,'matches'=>$matches];}}
echo json_encode($out,JSON_PRETTY_PRINT|JSON_UNESCAPED_SLASHES),PHP_EOL;
