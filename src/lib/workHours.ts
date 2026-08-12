// ============================================================================
// Arbeitszeit-Fenster (giờ làm) je Wochentag + Feiertag. Das ist das Fenster,
// in dem Schichten geplant werden dürfen (Früh am Fenster-Beginn, Spät am
// Fenster-Ende). Feiertage (Rheinland-Pfalz) werden für Nachfrage & Spätquote wie Sonntag
// behandelt, verwenden aber ihr eigenes Zeitfenster.
// ============================================================================

import { parseIsoDate, weekdayKeyOf, type WeekdayKey } from "./demand";

export type DayWindow = { startMinutes: number; endMinutes: number };

export type WorkHoursConfig = {
  perWeekday: Record<WeekdayKey, DayWindow>;
  holiday: DayWindow;
  /**
   * Wochentage, an denen der Laden grundsätzlich geschlossen ist (kein Dienst).
   * Bei Dong Do ist das der Sonntag. Ein Datum-Override mit eigenen Zeiten kann
   * einen solchen Tag im Einzelfall trotzdem öffnen.
   */
  closedWeekdays: Record<WeekdayKey, boolean>;
};

/**
 * Ausnahme für ein konkretes Datum (überschreibt Wochentag/Feiertag).
 * closed = an diesem Tag wird nicht geplant (z.B. Betriebsruhe);
 * window = abweichende Arbeitszeiten (z.B. halber Tag).
 */
export type DateOverride = {
  date: string; // ISO yyyy-MM-dd
  closed: boolean;
  window?: DayWindow;
  note?: string;
};

export type OverrideMap = Record<string, DateOverride>;

export type ResolvedDay = { closed: boolean; window: DayWindow };

const w = (start: number, end: number): DayWindow => ({ startMinutes: start, endMinutes: end });

// Vorgabe des Chefs (Dong Do Imbiss): Arbeitszeit (Schichtplanung, nicht
// zwingend die Öffnungszeit) täglich 10:00–20:00. Ohne Pause passt die längste
// Schicht (8 h Anwesenheit) bequem in das 10-h-Fenster – früh wie spät.
// Sonntag ist geschlossen (siehe closedWeekdays), das Fenster bleibt aber
// gesetzt, falls der Chef den Tag im Einzelfall öffnet.
const ALL_DAYS = w(10 * 60, 20 * 60); // 10:00–20:00

export const DEFAULT_WORK_HOURS: WorkHoursConfig = {
  perWeekday: {
    monday: { ...ALL_DAYS },
    tuesday: { ...ALL_DAYS },
    wednesday: { ...ALL_DAYS },
    thursday: { ...ALL_DAYS },
    friday: { ...ALL_DAYS },
    saturday: { ...ALL_DAYS },
    sunday: { ...ALL_DAYS },
  },
  holiday: { ...ALL_DAYS },
  closedWeekdays: {
    monday: false,
    tuesday: false,
    wednesday: false,
    thursday: false,
    friday: false,
    saturday: false,
    sunday: true, // Dong Do: sonntags geschlossen
  },
};

/**
 * Für Nachfrage/Spätquote maßgeblicher Wochentag: Feiertage zählen wie Sonntag
 * (der Nutzer gruppiert „Sonntag & Feiertag").
 */
export function effectiveWeekdayKey(isoDate: string, holidays: Set<string>): WeekdayKey {
  if (holidays.has(isoDate)) return "sunday";
  return weekdayKeyOf(parseIsoDate(isoDate));
}

/** Arbeitszeit-Fenster für ein konkretes Datum (berücksichtigt Feiertage). */
export function resolveWorkWindow(
  config: WorkHoursConfig,
  isoDate: string,
  holidays: Set<string>,
): DayWindow {
  if (holidays.has(isoDate)) return config.holiday;
  return config.perWeekday[weekdayKeyOf(parseIsoDate(isoDate))];
}

/**
 * Vollständige Auflösung eines Tages inkl. Ausnahmen:
 * Ausnahme geschlossen > Ausnahme eigene Zeiten > geschlossener Wochentag
 * (z.B. Sonntag) > Feiertag > Wochentag.
 */
export function resolveDay(
  config: WorkHoursConfig,
  isoDate: string,
  holidays: Set<string>,
  overrides: OverrideMap = {},
): ResolvedDay {
  const ov = overrides[isoDate];
  if (ov?.closed) return { closed: true, window: { startMinutes: 0, endMinutes: 0 } };
  // Ein Override mit eigenen Zeiten öffnet den Tag auch dann, wenn der
  // Wochentag sonst geschlossen wäre (z.B. Sonderöffnung an einem Sonntag).
  if (ov?.window) return { closed: false, window: ov.window };
  const weekday = weekdayKeyOf(parseIsoDate(isoDate));
  if (config.closedWeekdays?.[weekday]) {
    return { closed: true, window: { startMinutes: 0, endMinutes: 0 } };
  }
  return { closed: false, window: resolveWorkWindow(config, isoDate, holidays) };
}

/** Ist der Laden an diesem Datum geschlossen? (für die Anzeige in der UI). */
export function isDayClosed(
  config: WorkHoursConfig,
  isoDate: string,
  holidays: Set<string>,
  overrides: OverrideMap = {},
): boolean {
  return resolveDay(config, isoDate, holidays, overrides).closed;
}

/** Tiefe Kopie mit Auffüllen fehlender Felder (für Migration alter Speicherstände). */
export function normalizeWorkHours(partial: Partial<WorkHoursConfig> | undefined): WorkHoursConfig {
  const base = DEFAULT_WORK_HOURS;
  const perWeekday = { ...base.perWeekday };
  if (partial?.perWeekday) {
    for (const key of Object.keys(perWeekday) as WeekdayKey[]) {
      const v = partial.perWeekday[key];
      if (v && typeof v.startMinutes === "number" && typeof v.endMinutes === "number") {
        perWeekday[key] = { startMinutes: v.startMinutes, endMinutes: v.endMinutes };
      }
    }
  }
  const holiday =
    partial?.holiday &&
    typeof partial.holiday.startMinutes === "number" &&
    typeof partial.holiday.endMinutes === "number"
      ? { ...partial.holiday }
      : { ...base.holiday };

  const closedWeekdays = { ...base.closedWeekdays };
  if (partial?.closedWeekdays) {
    for (const key of Object.keys(closedWeekdays) as WeekdayKey[]) {
      const v = partial.closedWeekdays[key];
      if (typeof v === "boolean") closedWeekdays[key] = v;
    }
  }
  return { perWeekday, holiday, closedWeekdays };
}
