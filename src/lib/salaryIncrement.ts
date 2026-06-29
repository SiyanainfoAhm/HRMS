export const INCREMENT_MONTH_OPTIONS = ["January", "July"] as const;

export type IncrementMonthOption = (typeof INCREMENT_MONTH_OPTIONS)[number];

export function normalizeIncrementMonth(raw: string): IncrementMonthOption | null {
  const lower = raw.trim().toLowerCase();
  if (lower === "jan" || lower === "january") return "January";
  if (lower === "jul" || lower === "july") return "July";
  return null;
}

export function defaultEffectiveStartDate(month: IncrementMonthOption, year: number): string {
  if (month === "January") return `${year}-01-01`;
  return `${year}-07-01`;
}

export function effectiveDateMatchesMonth(month: IncrementMonthOption, dateYmd: string): boolean {
  const parts = dateYmd.split("-");
  if (parts.length !== 3) return false;
  const m = Number(parts[1]);
  if (month === "January") return m === 1;
  return m === 7;
}

/** Round to nearest whole rupee */
export function calculateNewGrossBasic(currentGrossBasic: number, incrementPercentage: number): number {
  return Math.round(currentGrossBasic + currentGrossBasic * (incrementPercentage / 100));
}

export function incrementAmount(currentGrossBasic: number, incrementPercentage: number): number {
  const next = calculateNewGrossBasic(currentGrossBasic, incrementPercentage);
  return next - currentGrossBasic;
}

export function yearOptions(anchorYear = new Date().getFullYear(), span = 6): number[] {
  const years: number[] = [];
  for (let y = anchorYear - 1; y <= anchorYear + span; y++) {
    years.push(y);
  }
  return years;
}
