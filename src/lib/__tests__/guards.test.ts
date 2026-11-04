// ============================================================================
// Zwei Fälle, die der Chef durch eigene Eingaben auslösen kann:
//  - ein Soll, das kleiner ist als die kürzeste Schicht,
//  - eine Besetzung, die für die Stoßzeiten schlicht zu dünn ist.
// Beides muss sichtbar werden statt still zu passieren.
// ============================================================================

import { describe, expect, it } from "vitest";
import { generateSchedule } from "../scheduler";
import { analyzeSchedule } from "../analyze";
import { DEFAULT_WORK_HOURS } from "../workHours";
import type { Employee } from "../../types";

const emp = (id: string, type: Employee["employmentType"], hours: number): Employee => ({
  id,
  name: id,
  employmentType: type,
  targetMinutes: hours * 60,
});

const generate = (employees: Employee[]) =>
  generateSchedule({ year: 2026, month: 8, workHours: DEFAULT_WORK_HOURS, employees });

describe("Small targets use whole-hour shifts without pauses", () => {
  for (const hours of [1, 2, 3, 4]) it(`${hours}h remains schedulable`, () => {
    const shifts = generate([emp("a", "TEILZEIT", hours)]);
    expect(shifts.reduce((n, s) => n + s.paidMinutes, 0)).toBe(hours * 60);
    for (const shift of shifts) {
      expect([60, 120, 180, 240]).toContain(shift.paidMinutes);
      expect(shift.pauseMinutes).toBe(0);
    }
  });
});

describe("Stoßzeiten bei zu dünner Besetzung", () => {
  const employees = [emp("a", "VOLLZEIT", 176), emp("b", "VOLLZEIT", 176)];
  const shifts = generate(employees);

  it("plant trotzdem einen rechnerisch korrekten Monat", () => {
    for (const e of employees) {
      const sum = shifts
        .filter((s) => s.employeeId === e.id)
        .reduce((acc, s) => acc + s.paidMinutes, 0);
      expect(sum).toBe(e.targetMinutes);
    }
  });

  it("meldet die unterbesetzten Tage, statt sie zu verschweigen", () => {
    const analysis = analyzeSchedule({
      year: 2026,
      month: 8,
      workHours: DEFAULT_WORK_HOURS,
      employees,
      shifts,
    });
    // Mit zwei Leuten sind zwei besetzte Spitzen an jedem Tag nicht möglich –
    // entscheidend ist, dass die Auswertung das auch sagt.
    expect(analysis.peakViolations.length).toBeGreaterThan(0);
    for (const day of analysis.peakViolations) {
      expect(day.peaks.some((p) => !p.ok)).toBe(true);
    }
  });
});
