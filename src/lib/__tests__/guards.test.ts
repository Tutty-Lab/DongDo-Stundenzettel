// ============================================================================
// Unterbesetzung muss sichtbar werden statt still zu passieren.
//
// Dong Do: Mo–Sa 10:00–20:00; 12–18 Uhr mindestens 2 Leute, bis 20:00 bleibt
// immer mindestens eine Person.
// ============================================================================

import { describe, expect, it } from "vitest";
import { analyzeSchedule } from "../analyze";
import { DEFAULT_WORK_HOURS } from "../workHours";
import type { Employee, Shift } from "../../types";

const emp = (id: string): Employee => ({ id, name: id, employmentType: "TEILZEIT", targetMinutes: 60 * 60 });

const dienst = (id: string, date: string, from: number, to: number): Shift => ({
  id: `shift-${id}-${date}-${from}`,
  employeeId: id,
  date,
  startMinutes: from,
  endMinutes: to,
  pauseMinutes: 0,
  paidMinutes: to - from,
  shiftType: from >= 14 * 60 ? "LATE" : "EARLY",
  generated: true,
});

const peaksOf = (employees: Employee[], shifts: Shift[], date: string) =>
  analyzeSchedule({ year: 2026, month: 8, workHours: DEFAULT_WORK_HOURS, employees, shifts })
    .peakViolations.find((d) => d.date === date)?.peaks ?? [];

// 2026-08-04 ist ein Dienstag.
describe("Dong Do – Besetzung", () => {
  it("zwei Leute von 12 bis 18 Uhr und eine bis 20:00 ist in Ordnung", () => {
    const shifts = [dienst("a", "2026-08-04", 10 * 60, 18 * 60), dienst("b", "2026-08-04", 12 * 60, 20 * 60)];
    expect(peaksOf([emp("a"), emp("b")], shifts, "2026-08-04").filter((p) => !p.ok)).toEqual([]);
  });

  it("nur eine Person in der Stoßzeit wird gemeldet", () => {
    const shifts = [dienst("a", "2026-08-04", 10 * 60, 15 * 60), dienst("b", "2026-08-04", 15 * 60, 20 * 60)];
    const peak = peaksOf([emp("a"), emp("b")], shifts, "2026-08-04").find((p) => !p.ok && p.label === "Trưa");
    expect(peak?.minStaff).toBe(1);
    expect(peak?.required).toBe(2);
  });

  it("meldet, wenn bis 20:00 niemand mehr da ist", () => {
    const shifts = [dienst("a", "2026-08-04", 10 * 60, 18 * 60), dienst("b", "2026-08-04", 12 * 60, 19 * 60)];
    expect(peaksOf([emp("a"), emp("b")], shifts, "2026-08-04").some((p) => !p.ok && p.label === "Đóng cửa")).toBe(true);
  });
});
