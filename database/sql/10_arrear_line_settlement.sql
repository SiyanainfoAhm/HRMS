-- Settlement columns for arrear lines (see Laravel migration 2026_06_24_100000_add_arrear_line_settlement_columns.php)
-- Run via: php artisan migrate

-- Optional one-time backfill for already-confirmed payrolls (review before running):
-- UPDATE cirt_payroll_arrear_lines AS l
-- SET status = 'paid', paid_in_period_id = COALESCE(l.payroll_period_id, b.payroll_period_id)
-- FROM cirt_payroll_arrear_batches AS b
-- WHERE l.arrear_batch_id = b.id AND b.status = 'finalized' AND l.is_locked = true;
