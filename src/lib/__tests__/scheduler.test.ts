import { describe, expect, it } from "vitest";
import { generateSchedule } from "../scheduler";
import { validateSchedule } from "../validation";
import { maxConsecutiveRun } from "../consecutive";
import { SAMPLE_EMPLOYEES } from "../sampleData";
import { DEFAULT_WORK_HOURS } from "../workHours";
import { calculatePause } from "../time";

describe("Scheduler – August 2026 Beispieldaten", () => {
  const shifts = generateSchedule({ allowPartial: true,
    year: 2026,
    month: 8,
    workHours: DEFAULT_WORK_HOURS,
    employees: SAMPLE_EMPLOYEES,
  });

  it("verteilt insgesamt genau 1016 bezahlte Stunden", () => {
    const totalMinutes = shifts.reduce((s, x) => s + x.paidMinutes, 0);
    expect(totalMinutes).toBe(1016 * 60);
  });

  it("trifft jedes einzelne Mitarbeiter-Soll exakt", () => {
    const expected: Record<string, number> = {
      VZ1: 176, VZ2: 180, VZ3: 179, VZ4: 178,
      TZ1: 39, TZ2: 54, TZ3: 54, TZ4: 78, TZ5: 78,
    };
    for (const emp of SAMPLE_EMPLOYEES) {
      const assigned = shifts
        .filter((s) => s.employeeId === emp.id)
        .reduce((sum, s) => sum + s.paidMinutes, 0);
      expect(assigned).toBe(expected[emp.id] * 60);
    }
  });

  it("hält alle harten Regeln ein (Validierung grün)", () => {
    const result = validateSchedule(SAMPLE_EMPLOYEES, shifts);
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it("höchstens ein Dienst pro Mitarbeiter und Tag", () => {
    const seen = new Set<string>();
    for (const s of shifts) {
      const key = `${s.employeeId}#${s.date}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });

  it("nie mehr als 6 aufeinanderfolgende Arbeitstage", () => {
    for (const emp of SAMPLE_EMPLOYEES) {
      const dates = shifts.filter((s) => s.employeeId === emp.id).map((s) => s.date);
      expect(maxConsecutiveRun(dates)).toBeLessThanOrEqual(6);
    }
  });

  it("jede Schicht: paid <= 9 h und korrekte Pause", () => {
    for (const s of shifts) {
      expect(s.paidMinutes).toBeLessThanOrEqual(9 * 60);
      expect(s.pauseMinutes).toBe(calculatePause(s.paidMinutes));
      expect(s.endMinutes - s.startMinutes - s.pauseMinutes).toBe(s.paidMinutes);
    }
  });

  it("ist deterministisch (gleiche Eingabe => gleiche Ausgabe)", () => {
    const again = generateSchedule({ allowPartial: true,
      year: 2026,
      month: 8,
      workHours: DEFAULT_WORK_HOURS,
      employees: SAMPLE_EMPLOYEES,
    });
    expect(again.map((s) => `${s.date}|${s.employeeId}|${s.paidMinutes}|${s.shiftType}`)).toEqual(
      shifts.map((s) => `${s.date}|${s.employeeId}|${s.paidMinutes}|${s.shiftType}`),
    );
  });

  it("plant mehr Stunden am Samstag als am Montag", () => {
    const byDate = new Map<string, number>();
    for (const s of shifts) {
      byDate.set(s.date, (byDate.get(s.date) ?? 0) + s.paidMinutes);
    }
    // 2026-08-01 ist Samstag, 2026-08-03 ist Montag.
    const sat = byDate.get("2026-08-01") ?? 0;
    const mon = byDate.get("2026-08-03") ?? 0;
    expect(sat).toBeGreaterThan(mon);
  });
});

describe("Scheduler – weitere Monate robust", () => {
  it("erzeugt gültige Pläne für Februar (28 Tage)", () => {
    const shifts = generateSchedule({ allowPartial: true,
      year: 2026,
      month: 2,
      workHours: DEFAULT_WORK_HOURS,
      employees: SAMPLE_EMPLOYEES,
    });
    const result = validateSchedule(SAMPLE_EMPLOYEES, shifts);
    expect(result.valid).toBe(true);
  });
});
