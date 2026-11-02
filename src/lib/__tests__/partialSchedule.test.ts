import { describe, it, expect } from "vitest";
import { generateSchedule } from "../scheduler";
import { validateSchedule } from "../validation";
import { DEFAULT_WORK_HOURS } from "../workHours";
import { weekdayKeyOf, parseIsoDate } from "../demand";
import type { Employee } from "../../types";

describe("November partial schedule", () => {
  const employee: Employee = {
    id: "full-time", name: "Full-time", employmentType: "VOLLZEIT",
    targetMinutes: 168 * 60, maxDaysPerWeek: 5,
    availableWeekdays: ["tuesday", "wednesday", "thursday", "friday", "saturday"],
  };
  const employees: Employee[] = [employee,
    { id: "part-1", name: "Part 1", employmentType: "TEILZEIT", targetMinutes: 79 * 60, maxDaysPerWeek: 7 },
    { id: "part-2", name: "Part 2", employmentType: "TEILZEIT", targetMinutes: 55 * 60, maxDaysPerWeek: 5, availableWeekdays: ["monday", "tuesday", "thursday", "friday", "saturday"] },
    { id: "part-3", name: "Part 3", employmentType: "TEILZEIT", targetMinutes: 140 * 60, maxDaysPerWeek: 5, availableWeekdays: ["monday", "wednesday", "thursday", "friday", "saturday"] },
  ];
  it("returns 160 hours with a persistent shortage warning, preserving hard rules", () => {
    const shifts = generateSchedule({ year: 2026, month: 11,
      workHours: DEFAULT_WORK_HOURS, employees, allowPartial: true });
    const result = validateSchedule(employees, shifts);
    expect(shifts.filter(s => s.employeeId === employee.id)).toHaveLength(20);
    expect(result.summaries[0].assignedMinutes).toBe(160 * 60);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0].message).toContain("còn thiếu 8 giờ");
    for (const shift of shifts.filter(s => s.employeeId === employee.id)) {
      expect(employee.availableWeekdays).toContain(weekdayKeyOf(parseIsoDate(shift.date)));
      expect(shift.paidMinutes).toBeLessThanOrEqual(8 * 60);
    }
  });
  it("still reports excess hours as errors", () => {
    const shifts = generateSchedule({ year: 2026, month: 11,
      workHours: DEFAULT_WORK_HOURS, employees, allowPartial: true });
    const result = validateSchedule(employees.map(e => e.id === employee.id ? { ...e, targetMinutes: 150 * 60 } : e), shifts);
    expect(result.valid).toBe(false);
    expect(result.warnings).toEqual([]);
  });
});
