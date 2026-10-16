// ============================================================================
// Beispieldaten von Dong Do Imbiss. Monatsstunden, nicht je Woche.
// ============================================================================

import type { Employee, Schedule } from "../types";
import { DEFAULT_WORK_HOURS } from "./workHours";

export function makeEmployee(
  id: string,
  name: string,
  employmentType: Employee["employmentType"],
  targetHours: number,
): Employee {
  return { id, name, employmentType, targetMinutes: Math.round(targetHours * 60) };
}

/** Mitarbeiter mit WOCHENvertrag (hier nicht im Einsatz, bleibt für die Oberfläche). */
export function makeWeekly(
  id: string,
  name: string,
  employmentType: Employee["employmentType"],
  weeklyHours: number,
): Employee {
  return { id, name, employmentType, targetMinutes: 0, weeklyHours };
}

/**
 * Kunden-Demo („Demo Restaurant"): 10 erfundene Personen – 5 Vollzeit, 3 Teilzeit,
 * 2 Minijob, 6 Bồi und 4 Bếp (1.196 h im Monat).
 */
/** Startbelegschaft wie in der alten App. */
export function dongDoEmployees(): Employee[] {
  return [
    makeEmployee("VZ1", "VZ1", "VOLLZEIT", 176),
    makeEmployee("VZ2", "VZ2", "VOLLZEIT", 180),
    makeEmployee("VZ3", "VZ3", "VOLLZEIT", 179),
    makeEmployee("VZ4", "VZ4", "VOLLZEIT", 178),
    makeEmployee("TZ1", "TZ1", "TEILZEIT", 40),
    makeEmployee("TZ2", "TZ2", "TEILZEIT", 55),
    makeEmployee("TZ3", "TZ3", "TEILZEIT", 55),
    makeEmployee("TZ4", "TZ4", "TEILZEIT", 79),
    makeEmployee("TZ5", "TZ5", "TEILZEIT", 80),
  ];
}

/** Belegschaft der Standard-Filiale – für Tests und Altaufrufe. */
export const SAMPLE_EMPLOYEES: Employee[] = dongDoEmployees();

export function createSampleSchedule(): Schedule {
  return {
    companyName: "Dong Do Imbiss",
    address: "Johannes-Kepler-Str. 15, 55129 Mainz",
    year: 2026,
    month: 8, // August
    workHours: structuredClone(DEFAULT_WORK_HOURS),
    dateOverrides: [],
    employees: dongDoEmployees(),
    shifts: [],
  };
}
