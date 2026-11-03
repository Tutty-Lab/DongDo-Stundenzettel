import { describe, it, expect } from "vitest";
import { generateSchedule } from "../scheduler";
import { validateSchedule } from "../validation";
import { DEFAULT_WORK_HOURS } from "../workHours";
import { createManualShift } from "../shiftOps";
import type { Employee } from "../../types";
const employee = (hours: number): Employee => ({ id: "test", name: "Test", employmentType: "TEILZEIT", targetMinutes: hours * 60 });
describe("Under 100 monthly hours", () => {
  for (const hours of [55, 79, 99, 100]) it(`${hours} monthly hours`, () => {
    const emp = employee(hours);
    const shifts = generateSchedule({ year: 2026, month: 11, workHours: DEFAULT_WORK_HOURS, employees: [emp], allowPartial: true });
    expect(shifts.length).toBeGreaterThan(0);
    if (hours < 100) for (const shift of shifts) expect(shift.paidMinutes).toBe(180);
    else expect(shifts.some(s => s.paidMinutes >= 240)).toBe(true);
    const result = validateSchedule([emp], shifts);
    expect(result.errors).toEqual([]);
    if (hours === 99) expect(result.warnings.length).toBe(1);
  });
  it("flags manual shifts of 4 hours, accepts less than 4", () => {
    const emp = employee(55);
    expect(validateSchedule([emp], [createManualShift(emp.id, "2026-11-02", 600, 840, 0)]).errors).toHaveLength(1);
    expect(validateSchedule([emp], [createManualShift(emp.id, "2026-11-02", 600, 839, 0)]).errors).toEqual([]);
  });
});
