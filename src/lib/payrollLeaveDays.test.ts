import { equivalentPayableDays } from "./payrollLeaveDays";

function assertEqual(actual: number, expected: number, label: string) {
  if (actual !== expected) throw new Error(`${label}: expected ${expected}, received ${actual}`);
}

assertEqual(equivalentPayableDays(31, 1, 0), 30, "one EOL day");
assertEqual(equivalentPayableDays(31, 0, 2), 30, "two HPL days");
assertEqual(equivalentPayableDays(31, 1, 2), 29, "combined leave days");
assertEqual(equivalentPayableDays(31, 0, 1), 30.5, "half payable day precision");
assertEqual(equivalentPayableDays(31, 40, 6), 0, "payable day lower bound");
