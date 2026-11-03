import { describe, expect, it } from "vitest";
import { generateSchedule } from "../scheduler";
import { analyzeSchedule } from "../analyze";
import { validateSchedule } from "../validation";
import { DEFAULT_WORK_HOURS, resolveDay } from "../workHours";
import { mayWorkOn } from "../availability";
import { weekStartOf } from "../weeks";
import { publicHolidays } from "../holidays";
import type { Employee } from "../../types";

describe("Peak coverage with two short-shift employees", () => {
  const employees: Employee[] = [
    { id: "a", name: "A", employmentType: "TEILZEIT", targetMinutes: 79 * 60, maxDaysPerWeek: 7 },
    { id: "b", name: "B", employmentType: "TEILZEIT", targetMinutes: 55 * 60, maxDaysPerWeek: 5, availableWeekdays: ["monday", "tuesday", "thursday", "friday", "saturday"] },
    { id: "c", name: "C", employmentType: "TEILZEIT", targetMinutes: 140 * 60, maxDaysPerWeek: 5, availableWeekdays: ["monday", "wednesday", "thursday", "friday", "saturday"] },
    { id: "d", name: "D", employmentType: "VOLLZEIT", targetMinutes: 168 * 60, maxDaysPerWeek: 5, availableWeekdays: ["tuesday", "wednesday", "thursday", "friday", "saturday"] },
  ];
  it("covers all 16 feasible open days without losing hours or breaking employee limits", () => {
    const input = { year: 2026, month: 11, employees, workHours: DEFAULT_WORK_HOURS, allowPartial: true };
    const shifts = generateSchedule(input);
    const analysis = analyzeSchedule({ ...input, shifts });
    expect(analysis.totalPaidHours).toBe(429);
    expect(analysis.peakViolations.length).toBe(9);
    expect(validateSchedule(employees, shifts).errors).toEqual([]);
    const holidays = publicHolidays(input.year);
    for (const employee of employees) {
      const weeks = new Map<string, number>();
      for (const shift of shifts.filter(s => s.employeeId === employee.id)) {
        expect(mayWorkOn(employee, shift.date)).toBe(true);
        const day = resolveDay(input.workHours, shift.date, holidays);
        expect(day.closed).toBe(false);
        expect(shift.startMinutes).toBeGreaterThanOrEqual(day.window.startMinutes);
        expect(shift.endMinutes).toBeLessThanOrEqual(day.window.endMinutes);
        const week = weekStartOf(shift.date);
        weeks.set(week, (weeks.get(week) ?? 0) + 1);
      }
      expect([...weeks.values()].every(n => n <= employee.maxDaysPerWeek!)).toBe(true);
    }
    for (const day of analysis.days.filter(d => !d.closed)) {
      const onDay = shifts.filter(s => s.date === day.date);
      expect(onDay.some(s => s.startMinutes === 600)).toBe(true);
      expect(onDay.some(s => s.endMinutes === 1200)).toBe(true);
    }
    expect(generateSchedule(input)).toEqual(shifts);
    // Same configuration and seed used by the production snapshot.
    const productionSeed = "2026-11-vz-hoa:4740|emp-1786688494682-607551:3300|emp-1786688501128-575604:8400|emp-1790950454533-407965:10080";
    const productionIds = ["vz-hoa", "emp-1786688494682-607551", "emp-1786688501128-575604", "emp-1790950454533-407965"];
    const productionEmployees = employees.map((e, i) => ({ ...e, id: productionIds[i] }));
    const productionShifts = generateSchedule({ ...input, employees: productionEmployees, seed: productionSeed });
    expect(analyzeSchedule({ ...input, shifts: productionShifts }).peakViolations).toHaveLength(9);
  });
});
