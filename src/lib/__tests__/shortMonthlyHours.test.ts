import { describe, it, expect } from "vitest";
import { generateSchedule } from "../scheduler";
import { validateSchedule } from "../validation";
import { DEFAULT_WORK_HOURS } from "../workHours";
import { createManualShift } from "../shiftOps";
import type { Employee } from "../../types";
const employee = (hours: number): Employee => ({ id: "test", name: "Test", employmentType: "TEILZEIT", targetMinutes: hours * 60 });
describe("Under 100 monthly hours", () => {
  for (const hours of [1, 2, 55, 79, 99, 100]) it(`${hours} monthly hours`, () => {
    const emp = employee(hours);
    const shifts = generateSchedule({ year: 2026, month: 11, workHours: DEFAULT_WORK_HOURS, employees: [emp], allowPartial: true });
    expect(shifts.length).toBeGreaterThan(0);
    if (hours < 100) for (const shift of shifts) { expect(shift.paidMinutes).toBeGreaterThanOrEqual(60); expect(shift.paidMinutes).toBeLessThanOrEqual(240); expect(shift.paidMinutes % 60).toBe(0); expect(shift.pauseMinutes).toBe(0); }
    else expect(shifts.some(s => s.paidMinutes >= 240)).toBe(true);
    const result = validateSchedule([emp], shifts);
    expect(result.errors).toEqual([]);
    expect(result.summaries[0].assignedMinutes).toBe(hours * 60);
  });
  it("accepts 4h, rejects fractional hours", () => {
    const emp = employee(55);
    expect(validateSchedule([emp], [createManualShift(emp.id, "2026-11-02", 600, 825, 0)]).errors).toHaveLength(1);
    expect(validateSchedule([emp], [createManualShift(emp.id, "2026-11-02", 600, 840, 0)]).errors).toEqual([]);
  });
});
