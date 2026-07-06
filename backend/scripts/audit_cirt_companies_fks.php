<?php

require __DIR__.'/../vendor/autoload.php';
$app = require __DIR__.'/../bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();

$sql = <<<'SQL'
SELECT con.conname AS fk_name,
       src.relname AS source_table,
       src_att.attname AS source_column,
       tgt.relname AS parent_table,
       CASE con.confdeltype
         WHEN 'c' THEN 'CASCADE'
         WHEN 'n' THEN 'SET NULL'
         WHEN 'r' THEN 'RESTRICT'
         ELSE con.confdeltype::text
       END AS on_delete
FROM pg_constraint con
JOIN pg_class src ON src.oid = con.conrelid
JOIN pg_namespace src_ns ON src_ns.oid = src.relnamespace
JOIN pg_class tgt ON tgt.oid = con.confrelid
JOIN pg_attribute src_att
  ON src_att.attrelid = con.conrelid
 AND src_att.attnum = ANY (con.conkey)
 AND src_att.attnum > 0
 AND NOT src_att.attisdropped
WHERE con.contype = 'f'
  AND src_ns.nspname = 'public'
  AND tgt.relname IN ('cirt_institute', 'cirt_companies', 'HRMS_companies')
ORDER BY source_table, fk_name
SQL;

$rows = Illuminate\Support\Facades\DB::select($sql);
echo "Inbound FKs to cirt_institute / cirt_companies / HRMS_companies: ".count($rows)."\n\n";
foreach ($rows as $r) {
    echo sprintf(
        "%-40s %-12s -> %-18s %-10s [%s]\n",
        $r->source_table,
        $r->source_column,
        $r->parent_table,
        $r->on_delete,
        $r->fk_name,
    );
}

$noFk = Illuminate\Support\Facades\DB::select(<<<'SQL'
SELECT c.relname AS table_name
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
JOIN pg_attribute a ON a.attrelid = c.oid
WHERE n.nspname = 'public'
  AND c.relkind = 'r'
  AND a.attname = 'company_id'
  AND a.attnum > 0
  AND NOT a.attisdropped
  AND c.relname LIKE 'cirt_%'
  AND NOT EXISTS (
    SELECT 1 FROM pg_constraint fk
    JOIN pg_class src ON src.oid = fk.conrelid
    JOIN pg_class tgt ON tgt.oid = fk.confrelid
    WHERE fk.contype = 'f' AND src.oid = c.oid
      AND tgt.relname IN ('cirt_institute', 'cirt_companies', 'HRMS_companies')
  )
ORDER BY table_name
SQL);

echo "\ncompany_id columns on cirt_* WITHOUT formal FK:\n";
foreach ($noFk as $r) {
    echo "  - {$r->table_name}\n";
}
