/**
 * Run: npx --yes tsx src/lib/payrollCpfCalculation.test.ts
 */
import {
  calculateCpfFromBasis,
  firstFiniteNumber,
  resolveEffectiveCpf,
  resolveEffectiveCpfConfigForMaster,
  resolveMasterCpfBasisAmount,
} from "./payrollCpfCalculation";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}
function assertEq(a: unknown, b: unknown, msg: string) {
  if (a !== b) throw new Error(`${msg}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}

const INSTITUTE_PCT = 12;
const BASIS = 185516; // yields ~22262 at 12%
const INSTITUTE_CPF = Math.round(BASIS * (INSTITUTE_PCT / 100));

function testFirstFiniteKeepsZero() {
  assertEq(firstFiniteNumber(0, 5), 0, "zero wins");
  assertEq(firstFiniteNumber(null, undefined, "", 0), 0, "zero after empty");
  assertEq(firstFiniteNumber(undefined, 12), 12, "fallback");
}

function testCustomFixedZero() {
  const config = resolveEffectiveCpfConfigForMaster({
    cpfUseCompanySettings: false,
    cpfCalculationModeOverride: "fixed_amount",
    cpfFixedAmountOverride: 0,
    companyCpfPercentage: INSTITUTE_PCT,
    companyCpfBasisFieldKeys: ["gross_basic", "da", "hra", "medical", "transport"],
  });
  assertEq(config.cpfCalculationMode, "fixed_amount", "mode");
  assertEq(config.cpfFixedAmount, 0, "fixed");
  const amt = calculateCpfFromBasis(0, BASIS, config.cpfPercentage, BASIS, "fixed_amount", 0);
  assertEq(amt, 0, "effective 0");
  assert(amt !== INSTITUTE_CPF, "not institute");
}

function testCustomFixed500() {
  const resolved = resolveEffectiveCpf({
    employeeCpfConfig: {
      cpfUseCompanySettings: false,
      cpfCalculationModeOverride: "fixed_amount",
      cpfFixedAmountOverride: 500,
      companyCpfPercentage: INSTITUTE_PCT,
    },
    basisAmount: BASIS,
    legacyTotalEarnings: BASIS,
  });
  assertEq(resolved.effectiveCpf, 500, "500");
  assertEq(resolved.source, "employee", "source");
}

function testCustomFixed22262() {
  const amt = calculateCpfFromBasis(0, BASIS, 12, BASIS, "fixed_amount", 22262);
  assertEq(amt, 22262, "explicit fixed");
}

function testInstituteDefault() {
  const resolved = resolveEffectiveCpf({
    employeeCpfConfig: {
      cpfUseCompanySettings: true,
      companyCpfPercentage: INSTITUTE_PCT,
      companyCpfBasisFieldKeys: ["gross_basic"],
      companyCpfCalculationMode: "percentage",
    },
    basisAmount: 100000,
    legacyTotalEarnings: 100000,
  });
  assertEq(resolved.source, "company", "company");
  assertEq(resolved.effectiveCpf, 12000, "12% of 100000");
}

function testCustomZeroPercentOverride() {
  const config = resolveEffectiveCpfConfigForMaster({
    cpfUseCompanySettings: false,
    cpfCalculationModeOverride: "percentage",
    cpfPercentageOverride: 0,
    cpfBasisFieldKeysOverride: ["gross_basic"],
    companyCpfPercentage: 12,
  });
  assertEq(config.cpfPercentage, 0, "0% override kept");
  const amt = calculateCpfFromBasis(0, 100000, 0, 100000, "percentage", 0, { strictBasis: true });
  assertEq(amt, 0, "0% of basis");
}

function testSwitchInstituteToCustomFixedZero() {
  const before = resolveEffectiveCpf({
    employeeCpfConfig: {
      cpfUseCompanySettings: true,
      companyCpfPercentage: 12,
      companyCpfCalculationMode: "percentage",
    },
    basisAmount: BASIS,
  });
  assert(before.effectiveCpf > 0, "institute nonzero");

  const after = resolveEffectiveCpf({
    employeeCpfConfig: {
      cpfUseCompanySettings: false,
      cpfCalculationModeOverride: "fixed_amount",
      cpfFixedAmountOverride: "0",
      companyCpfPercentage: 12,
    },
    basisAmount: BASIS,
  });
  assertEq(after.effectiveCpf, 0, "switch to 0");
}

function testSwitchCustomZeroToInstitute() {
  const after = resolveEffectiveCpf({
    employeeCpfConfig: {
      cpfUseCompanySettings: true,
      companyCpfPercentage: 12,
      companyCpfBasisFieldKeys: ["gross_basic"],
      companyCpfCalculationMode: "percentage",
    },
    basisAmount: 100000,
  });
  assertEq(after.effectiveCpf, 12000, "back to institute");
}

function testMasterPreviewPathMatchesRun() {
  const basis = resolveMasterCpfBasisAmount(
    { gross_basic_pay: 90000, da_amount: 47700, hra_amount: 27000, medical: 3000, transport_total: 17816 },
    ["gross_basic", "da", "hra", "medical", "transport"],
  );
  const institute = calculateCpfFromBasis(0, basis, 12, basis, "percentage", 0);
  const customZero = calculateCpfFromBasis(0, basis, 12, basis, "fixed_amount", 0);
  assert(institute > 0, "institute calc");
  assertEq(customZero, 0, "custom fixed 0");
}

const tests = [
  testFirstFiniteKeepsZero,
  testCustomFixedZero,
  testCustomFixed500,
  testCustomFixed22262,
  testInstituteDefault,
  testCustomZeroPercentOverride,
  testSwitchInstituteToCustomFixedZero,
  testSwitchCustomZeroToInstitute,
  testMasterPreviewPathMatchesRun,
];

let failed = 0;
for (const t of tests) {
  try {
    t();
    console.log(`ok - ${t.name}`);
  } catch (e) {
    failed += 1;
    console.error(`FAIL - ${t.name}:`, e);
  }
}
if (failed) process.exit(1);
console.log(`\n${tests.length} passed`);
