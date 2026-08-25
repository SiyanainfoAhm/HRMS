/**
 * Progressive electricity tariff calculation for CIRT Payroll.
 * Intermediate amounts use 2-decimal money; final deduction uses whole-rupee rounding
 * to match existing government payroll deduction fields.
 */

export type ElectricityTariffSlab = {
  fromUnit: number;
  /** null / undefined = no upper limit */
  toUnit: number | null;
  ratePerUnit: number;
  sortOrder?: number;
};

export type ElectricityTariffConfig = {
  id?: string | null;
  effectiveFrom?: string | null;
  sthirAakar: number;
  vahanAakarPerUnit: number;
  fuelCharge: number;
  dutyPercentage: number;
  slabs: ElectricityTariffSlab[];
  isActive?: boolean;
};

export type ElectricitySlabPortion = {
  fromUnit: number;
  toUnit: number | null;
  units: number;
  ratePerUnit: number;
  amount: number;
};

export type ElectricityBillBreakdown = {
  units: number;
  applicable: boolean;
  mode: "unit_based" | "manual_fixed";
  tariffId: string | null;
  sthirAakar: number;
  consumptionCharge: number;
  vahanAakar: number;
  fuelCharge: number;
  subtotal: number;
  dutyPercentage: number;
  dutyAmount: number;
  /** Pre-rounding total (2 decimals). */
  totalExact: number;
  /** Whole-rupee amount for payroll deduction fields. */
  total: number;
  slabPortions: ElectricitySlabPortion[];
  manualOverride: boolean;
  manualAmount: number | null;
};

/** Money to 2 decimal places (paisa). */
export function roundMoney2(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round(Math.max(0, n) * 100) / 100;
}

/** Whole rupees — matches governmentPayroll.roundRupees for final deductions. */
export function roundElectricityDeduction(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round(Math.max(0, n));
}

export function normalizeElectricitySlabs(slabs: ElectricityTariffSlab[]): ElectricityTariffSlab[] {
  return [...slabs]
    .map((s, i) => ({
      fromUnit: Math.max(0, Number(s.fromUnit) || 0),
      toUnit:
        s.toUnit === null || s.toUnit === undefined
          ? null
          : Math.max(0, Number(s.toUnit) || 0),
      ratePerUnit: Math.max(0, Number(s.ratePerUnit) || 0),
      sortOrder: s.sortOrder ?? i + 1,
    }))
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.fromUnit - b.fromUnit);
}

/**
 * Progressive slab charge.
 * Contiguous bands such as 0–100, 101–300 bill the first 100 units, next 200, etc.
 */
export function calculateElectricitySlabCharge(
  units: number,
  slabs: ElectricityTariffSlab[],
): { charge: number; portions: ElectricitySlabPortion[] } {
  const u = Math.max(0, Number(units) || 0);
  const sorted = normalizeElectricitySlabs(slabs);
  const portions: ElectricitySlabPortion[] = [];
  if (u <= 0 || sorted.length === 0) {
    return { charge: 0, portions };
  }

  let billed = 0;
  for (const slab of sorted) {
    if (billed >= u) break;
    const upper = slab.toUnit === null ? Number.POSITIVE_INFINITY : slab.toUnit;
    const capacity = Number.isFinite(upper) ? Math.max(0, upper - billed) : Number.POSITIVE_INFINITY;
    const take = Math.min(u - billed, capacity);
    if (take <= 0) continue;
    const amount = roundMoney2(take * slab.ratePerUnit);
    portions.push({
      fromUnit: slab.fromUnit,
      toUnit: slab.toUnit,
      units: take,
      ratePerUnit: slab.ratePerUnit,
      amount,
    });
    billed += take;
  }

  const charge = roundMoney2(portions.reduce((s, p) => s + p.amount, 0));
  return { charge, portions };
}

export function validateElectricitySlabs(slabs: ElectricityTariffSlab[]): string[] {
  const errors: string[] = [];
  const sorted = normalizeElectricitySlabs(slabs);
  if (sorted.length === 0) {
    errors.push("At least one slab is required.");
    return errors;
  }

  for (let i = 0; i < sorted.length; i++) {
    const s = sorted[i];
    if (s.fromUnit < 0 || s.ratePerUnit < 0) {
      errors.push(`Slab ${i + 1}: units and rate must be >= 0.`);
    }
    if (s.toUnit !== null && s.toUnit < s.fromUnit) {
      errors.push(`Slab ${i + 1}: upper unit must be >= lower unit.`);
    }
    if (s.toUnit === null && i !== sorted.length - 1) {
      errors.push("Only the last slab may have no upper limit.");
    }
  }

  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const cur = sorted[i];
    if (prev.toUnit === null) {
      errors.push("A slab after an open-ended slab is not allowed.");
      break;
    }
    if (cur.fromUnit <= prev.toUnit) {
      errors.push(`Slabs overlap: ${prev.fromUnit}–${prev.toUnit} and ${cur.fromUnit}–${cur.toUnit ?? "∞"}.`);
    } else if (cur.fromUnit !== prev.toUnit + 1) {
      errors.push(`Gap between slabs: expected next from ${prev.toUnit + 1}, got ${cur.fromUnit}.`);
    }
  }

  if (sorted[0].fromUnit > 1) {
    errors.push("First slab should start at 0 or 1.");
  }

  return errors;
}

export type CalculateElectricityBillInput = {
  units: number;
  tariff: ElectricityTariffConfig | null | undefined;
  applicable?: boolean;
  mode?: "unit_based" | "manual_fixed";
  legacyUnitRate?: number;
  fixedAmount?: number;
  manualOverride?: boolean;
  manualAmount?: number | null;
};

/**
 * Full electricity bill:
 * Sthir + progressive slab + (units × vahan) + fuel + duty% on those four.
 */
export function calculateElectricityBill(input: CalculateElectricityBillInput): ElectricityBillBreakdown {
  const applicable = input.applicable !== false;
  const mode = input.mode === "manual_fixed" ? "manual_fixed" : "unit_based";
  const units = Math.max(0, Number(input.units) || 0);
  const manualOverride = Boolean(input.manualOverride);
  const manualRaw = input.manualAmount;
  const manualAmount =
    manualRaw === null || manualRaw === undefined
      ? null
      : roundElectricityDeduction(Number(manualRaw));

  const empty = (partial: Partial<ElectricityBillBreakdown>): ElectricityBillBreakdown => ({
    units,
    applicable,
    mode,
    tariffId: input.tariff?.id ?? null,
    sthirAakar: 0,
    consumptionCharge: 0,
    vahanAakar: 0,
    fuelCharge: 0,
    subtotal: 0,
    dutyPercentage: 0,
    dutyAmount: 0,
    totalExact: 0,
    total: 0,
    slabPortions: [],
    manualOverride,
    manualAmount,
    ...partial,
  });

  if (!applicable) {
    return empty({ total: 0, totalExact: 0 });
  }

  if (manualOverride && manualAmount !== null) {
    const base = computeTariffBreakdown(units, input.tariff, input.legacyUnitRate, input.fixedAmount);
    return {
      ...base,
      units,
      applicable,
      mode,
      manualOverride: true,
      manualAmount,
      total: manualAmount,
      totalExact: manualAmount,
    };
  }

  if (mode === "manual_fixed") {
    const fixed = roundElectricityDeduction(Number(input.fixedAmount) || 0);
    return empty({
      total: fixed,
      totalExact: fixed,
      consumptionCharge: fixed,
      subtotal: fixed,
    });
  }

  return {
    ...computeTariffBreakdown(units, input.tariff, input.legacyUnitRate, input.fixedAmount),
    units,
    applicable,
    mode,
    manualOverride: false,
    manualAmount: null,
  };
}

function computeTariffBreakdown(
  units: number,
  tariff: ElectricityTariffConfig | null | undefined,
  legacyUnitRate: number | undefined,
  fixedAmount: number | undefined,
): Omit<ElectricityBillBreakdown, "units" | "applicable" | "mode" | "manualOverride" | "manualAmount"> {
  if (tariff && Array.isArray(tariff.slabs) && tariff.slabs.length > 0) {
    const sthirAakar = roundMoney2(Number(tariff.sthirAakar) || 0);
    const fuelCharge = roundMoney2(Number(tariff.fuelCharge) || 0);
    const vahanRate = Math.max(0, Number(tariff.vahanAakarPerUnit) || 0);
    const dutyPercentage = Math.max(0, Number(tariff.dutyPercentage) || 0);
    const { charge: consumptionCharge, portions } = calculateElectricitySlabCharge(units, tariff.slabs);
    const vahanAakar = roundMoney2(units * vahanRate);
    const subtotal = roundMoney2(sthirAakar + consumptionCharge + vahanAakar + fuelCharge);
    const dutyAmount = roundMoney2((subtotal * dutyPercentage) / 100);
    const totalExact = roundMoney2(subtotal + dutyAmount);
    return {
      tariffId: tariff.id ?? null,
      sthirAakar,
      consumptionCharge,
      vahanAakar,
      fuelCharge,
      subtotal,
      dutyPercentage,
      dutyAmount,
      totalExact,
      total: roundElectricityDeduction(totalExact),
      slabPortions: portions,
    };
  }

  const rate = Math.max(0, Number(legacyUnitRate) || 0);
  if (units > 0 && rate > 0) {
    const consumptionCharge = roundMoney2(units * rate);
    return {
      tariffId: null,
      sthirAakar: 0,
      consumptionCharge,
      vahanAakar: 0,
      fuelCharge: 0,
      subtotal: consumptionCharge,
      dutyPercentage: 0,
      dutyAmount: 0,
      totalExact: consumptionCharge,
      total: roundElectricityDeduction(consumptionCharge),
      slabPortions: [
        { fromUnit: 0, toUnit: units, units, ratePerUnit: rate, amount: consumptionCharge },
      ],
    };
  }

  const fixed = roundElectricityDeduction(Number(fixedAmount) || 0);
  return {
    tariffId: null,
    sthirAakar: 0,
    consumptionCharge: fixed,
    vahanAakar: 0,
    fuelCharge: 0,
    subtotal: fixed,
    dutyPercentage: 0,
    dutyAmount: 0,
    totalExact: fixed,
    total: fixed,
    slabPortions: [],
  };
}

/** April 2026 CIRT initial tariff (seed/reference — DB is authoritative in production). */
export const DEFAULT_APRIL_2026_ELECTRICITY_TARIFF: ElectricityTariffConfig = {
  effectiveFrom: "2026-04-01",
  sthirAakar: 130,
  vahanAakarPerUnit: 1.6,
  fuelCharge: 200.7,
  dutyPercentage: 16,
  slabs: [
    { fromUnit: 0, toUnit: 100, ratePerUnit: 3.96, sortOrder: 1 },
    { fromUnit: 101, toUnit: 300, ratePerUnit: 10.8, sortOrder: 2 },
    { fromUnit: 301, toUnit: 500, ratePerUnit: 15.03, sortOrder: 3 },
    { fromUnit: 501, toUnit: 1000, ratePerUnit: 17.53, sortOrder: 4 },
    { fromUnit: 1001, toUnit: null, ratePerUnit: 17.53, sortOrder: 5 },
  ],
};
