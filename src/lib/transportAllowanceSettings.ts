/**
 * Institute Transport Allowance settings (aligned with cirt_institute columns /
 * PayrollCalculationService defaults).
 *
 * Bands (contiguous):
 * - High: payLevel >= highMinLevel
 * - Mid:  midMinLevel <= payLevel < highMinLevel
 * - Low:  1 <= payLevel < midMinLevel (enhanced when basic >= threshold)
 */

export type TransportAllowanceSettings = {
  level9Plus: number;
  level38: number;
  level12: number;
  level12Enhanced: number;
  basicThreshold: number;
  /** Minimum Pay Level for the high band (default 9). */
  highMinLevel: number;
  /** Minimum Pay Level for the mid band (default 3). */
  midMinLevel: number;
};

export const DEFAULT_TRANSPORT_ALLOWANCE_SETTINGS: TransportAllowanceSettings = {
  level9Plus: 7200,
  level38: 3600,
  level12: 1350,
  level12Enhanced: 3600,
  basicThreshold: 24200,
  highMinLevel: 9,
  midMinLevel: 3,
};

/** Accept snake_case API company payload or camelCase form values. */
export function normalizeTransportAllowanceSettings(
  source?: Record<string, unknown> | null,
): TransportAllowanceSettings {
  const defaults = DEFAULT_TRANSPORT_ALLOWANCE_SETTINGS;
  if (!source) return { ...defaults };

  const num = (keys: string[], fallback: number, opts?: { int?: boolean; min?: number }): number => {
    for (const key of keys) {
      const raw = source[key];
      if (raw === null || raw === undefined || raw === "") continue;
      const n = typeof raw === "string" ? parseFloat(raw) : Number(raw);
      if (!Number.isFinite(n) || n < 0) continue;
      const value = opts?.int ? Math.floor(n) : n;
      if (opts?.min != null && value < opts.min) continue;
      return value;
    }
    return fallback;
  };

  let highMinLevel = num(
    [
      "transport_allowance_high_min_level",
      "transportAllowanceHighMinLevel",
      "highMinLevel",
      "high_min_level",
    ],
    defaults.highMinLevel,
    { int: true, min: 2 },
  );
  let midMinLevel = num(
    [
      "transport_allowance_mid_min_level",
      "transportAllowanceMidMinLevel",
      "midMinLevel",
      "mid_min_level",
    ],
    defaults.midMinLevel,
    { int: true, min: 1 },
  );
  if (midMinLevel >= highMinLevel) {
    midMinLevel = Math.max(1, highMinLevel - 1);
  }

  return {
    level9Plus: num(
      ["transport_allowance_level_9_plus", "transportAllowanceLevel9Plus", "level9Plus", "level_9_plus"],
      defaults.level9Plus,
    ),
    level38: num(
      ["transport_allowance_level_3_8", "transportAllowanceLevel38", "level38", "level_3_8"],
      defaults.level38,
    ),
    level12: num(
      ["transport_allowance_level_1_2", "transportAllowanceLevel12", "level12", "level_1_2"],
      defaults.level12,
    ),
    level12Enhanced: num(
      [
        "transport_allowance_level_1_2_enhanced",
        "transportAllowanceLevel12Enhanced",
        "level12Enhanced",
        "level_1_2_enhanced",
      ],
      defaults.level12Enhanced,
    ),
    basicThreshold: num(
      [
        "transport_allowance_basic_threshold",
        "transportAllowanceBasicThreshold",
        "basicThreshold",
        "basic_threshold",
      ],
      defaults.basicThreshold,
    ),
    highMinLevel,
    midMinLevel,
  };
}

export function transportBandLabels(settings: TransportAllowanceSettings) {
  const high = Math.max(2, Math.floor(settings.highMinLevel || 9));
  const mid = Math.max(1, Math.min(high - 1, Math.floor(settings.midMinLevel || 3)));
  const midMax = high - 1;
  const lowMax = mid - 1;
  return {
    high: `Level ${high} & Above`,
    mid: mid === midMax ? `Level ${mid}` : `Level ${mid} to ${midMax}`,
    low: lowMax <= 1 ? `Level 1` : `Level 1 to ${lowMax}`,
    lowEnhanced: lowMax <= 1 ? `Level 1 Enhanced` : `Level 1 to ${lowMax} Enhanced`,
  };
}

export function getTransportBaseByPayLevel(
  payLevel: number,
  grossBasicPay = 0,
  settings: TransportAllowanceSettings = DEFAULT_TRANSPORT_ALLOWANCE_SETTINGS,
): number {
  const lv = Math.max(0, Math.floor(Number(payLevel) || 0));
  const basic = Math.max(0, Number(grossBasicPay) || 0);
  const highMin = Math.max(2, Math.floor(settings.highMinLevel || 9));
  const midMin = Math.max(1, Math.min(highMin - 1, Math.floor(settings.midMinLevel || 3)));
  if (lv >= highMin) return settings.level9Plus;
  if (lv >= midMin) return settings.level38;
  if (lv >= 1) {
    return basic >= settings.basicThreshold ? settings.level12Enhanced : settings.level12;
  }
  return 0;
}

export function deriveTransportSlab(
  payLevel: number,
  grossBasicPay = 0,
  settings: TransportAllowanceSettings = DEFAULT_TRANSPORT_ALLOWANCE_SETTINGS,
): { group: string; base: number } {
  const lv = Math.max(0, Math.floor(Number(payLevel) || 0));
  const base = getTransportBaseByPayLevel(lv, grossBasicPay, settings);
  const highMin = Math.max(2, Math.floor(settings.highMinLevel || 9));
  const midMin = Math.max(1, Math.min(highMin - 1, Math.floor(settings.midMinLevel || 3)));
  if (lv >= highMin) return { group: "LEVEL_9_ABOVE", base };
  if (lv >= midMin) return { group: "LEVEL_3_8", base };
  if (lv >= 1) {
    const basic = Math.max(0, Number(grossBasicPay) || 0);
    if (basic >= settings.basicThreshold) return { group: "LEVEL_1_2_ENHANCED", base };
    return { group: "LEVEL_1_2", base };
  }
  return { group: "UNKNOWN", base: 0 };
}

export function transportSettingsToApiPayload(settings: TransportAllowanceSettings) {
  return {
    transportAllowanceLevel9Plus: settings.level9Plus,
    transportAllowanceLevel38: settings.level38,
    transportAllowanceLevel12: settings.level12,
    transportAllowanceLevel12Enhanced: settings.level12Enhanced,
    transportAllowanceBasicThreshold: settings.basicThreshold,
    transportAllowanceHighMinLevel: settings.highMinLevel,
    transportAllowanceMidMinLevel: settings.midMinLevel,
  };
}
