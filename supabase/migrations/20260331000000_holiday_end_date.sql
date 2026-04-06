-- Multi-day holidays (e.g. Pooja / Diwali) in one row: holiday_date = first day, holiday_end_date = last day (null = single day).
alter table if exists "HRMS_holidays"
  add column if not exists holiday_end_date date;
