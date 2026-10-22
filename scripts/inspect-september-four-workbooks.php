<?php
declare(strict_types=1);
use PhpOffice\PhpSpreadsheet\IOFactory;
require __DIR__.'/../backend/vendor/autoload.php';
$dir=__DIR__.'/../data/imports/september-2026';
$files=glob($dir.'/*.xlsx');
$need=['GHOTANE','KEDARI','DESAI','PATHARE','PENDHARKAR','MAGAR','MANDAVGADE','ADITYA'];
$out=[];
foreach($files as $file){$book=IOFactory::load($file);foreach($book->getWorksheetIterator() as $sheet){$headers=[];foreach($sheet->getRowIterator(1,1)->current()->getCellIterator() as $c)$headers[$c->getColumn()]=trim((string)$c->getFormattedValue());$matches=[];for($r=2;$r<=$sheet->getHighestDataRow();$r++){ $values=[];foreach($headers as $col=>$head)$values[$head]=trim((string)$sheet->getCell($col.$r)->getFormattedValue());$text=strtoupper(implode(' ',$values));foreach($need as $n)if(str_contains($text,$n)){$matches[]=$values;break;}}$out[basename($file)][$sheet->getTitle()]=['headers'=>$headers,'matches'=>$matches];}}
echo json_encode($out,JSON_PRETTY_PRINT|JSON_UNESCAPED_SLASHES),PHP_EOL;
