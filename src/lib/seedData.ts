// ============================================================================
// Test-Belegschaften für die drei zuletzt abgeschlossenen Monate.
//
// Zweck: den Scheduler gegen WECHSELNDE Belegschaften prüfen, nicht nur gegen
// die eine Beispielliste aus sampleData. Jeder Monat hat eine andere Mischung
// aus Vollzeit und Teilzeit, damit sichtbar wird, ob die Stoßzeiten-Regel auch
// bei dünner Besetzung noch trägt.
//
// Hinweis zum Datenmodell: Schedule hält immer GENAU EINEN Monat
// (year/month + employees + shifts). Diese drei Monate existieren deshalb
// nebeneinander nur hier als Fixture – in der App/Datenbank liegt jeweils der
// aktuell gewählte Monat.
// ============================================================================

import type { Employee, Schedule } from "../types";
import { COMPANY_ADDRESS, COMPANY_NAME } from "./company";
import { makeEmployee } from "./sampleData";
import { DEFAULT_WORK_HOURS } from "./workHours";

export type SeedMonth = {
  year: number;
  month: number; // 1-basiert
  label: string;
  employees: Employee[];
};

/**
 * Juni 2026 – kleine Stammbesetzung: 3 Vollzeit tragen den Laden,
 * 4 Teilzeit füllen die Spitzen auf.
 */
const JUNE_2026: Employee[] = [
  makeEmployee("vz-hoa", "Nguyễn Thị Hoa", "VOLLZEIT", 176),
  makeEmployee("vz-minh", "Trần Văn Minh", "VOLLZEIT", 168),
  makeEmployee("vz-lan", "Phạm Thị Lan", "VOLLZEIT", 160),
  makeEmployee("tz-an", "Lê Hoàng An", "TEILZEIT", 72),
  makeEmployee("tz-binh", "Đỗ Thanh Bình", "TEILZEIT", 60),
  makeEmployee("tz-chi", "Vũ Ngọc Chi", "TEILZEIT", 48),
  makeEmployee("tz-dung", "Bùi Tiến Dũng", "TEILZEIT", 40),
];

/**
 * Juli 2026 – Urlaubsmonat: eine Vollzeitkraft weniger, dafür mehr
 * Teilzeit-Aushilfen mit kleinen Deputaten. Der harte Fall für die
 * Stoßzeiten-Regel, weil viele kurze Schichten entstehen.
 */
const JULY_2026: Employee[] = [
  makeEmployee("vz-hoa", "Nguyễn Thị Hoa", "VOLLZEIT", 180),
  makeEmployee("vz-minh", "Trần Văn Minh", "VOLLZEIT", 172),
  makeEmployee("tz-an", "Lê Hoàng An", "TEILZEIT", 80),
  makeEmployee("tz-chi", "Vũ Ngọc Chi", "TEILZEIT", 64),
  makeEmployee("tz-em", "Ngô Thị Em", "TEILZEIT", 56),
  makeEmployee("tz-giang", "Hoàng Văn Giang", "TEILZEIT", 45),
  makeEmployee("tz-ha", "Đặng Thu Hà", "TEILZEIT", 36),
  makeEmployee("tz-khanh", "Lý Gia Khánh", "TEILZEIT", 30),
];

/**
 * August 2026 – volle Besetzung: 4 Vollzeit + 3 Teilzeit, deutlich mehr
 * Gesamtstunden. Hier muss die Nachfrage-Gewichtung sauber greifen.
 */
const AUGUST_2026: Employee[] = [
  makeEmployee("vz-hoa", "Nguyễn Thị Hoa", "VOLLZEIT", 184),
  makeEmployee("vz-minh", "Trần Văn Minh", "VOLLZEIT", 176),
  makeEmployee("vz-lan", "Phạm Thị Lan", "VOLLZEIT", 176),
  makeEmployee("vz-son", "Trịnh Quang Sơn", "VOLLZEIT", 168),
  makeEmployee("tz-an", "Lê Hoàng An", "TEILZEIT", 75),
  makeEmployee("tz-binh", "Đỗ Thanh Bình", "TEILZEIT", 60),
  makeEmployee("tz-chi", "Vũ Ngọc Chi", "TEILZEIT", 50),
];

/** Die drei zuletzt abgeschlossenen Monate, ältester zuerst. */
export const SEED_MONTHS: SeedMonth[] = [
  { year: 2026, month: 6, label: "Juni 2026", employees: JUNE_2026 },
  { year: 2026, month: 7, label: "Juli 2026", employees: JULY_2026 },
  { year: 2026, month: 8, label: "August 2026", employees: AUGUST_2026 },
];

/** Baut einen leeren Schedule (ohne Schichten) für einen Seed-Monat. */
export function scheduleForSeed(seed: SeedMonth): Schedule {
  return {
    companyName: COMPANY_NAME,
    address: COMPANY_ADDRESS,
    year: seed.year,
    month: seed.month,
    workHours: structuredClone(DEFAULT_WORK_HOURS),
    dateOverrides: [],
    employees: seed.employees.map((e) => ({ ...e })),
    shifts: [],
  };
}

/** Summe der Sollstunden eines Seed-Monats (für Kapazitäts-Checks). */
export function totalTargetHours(seed: SeedMonth): number {
  return seed.employees.reduce((sum, e) => sum + e.targetMinutes, 0) / 60;
}
