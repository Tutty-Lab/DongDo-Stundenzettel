// ============================================================================
// Deterministischer, greedy Scheduler (kein Solver, kein KI-Modell).
//
// Vorgehen:
//  1. Alle Tage des Monats + Nachfrage-Gewichte -> rohes Tages-Soll (Minuten).
//  2. Sollstunden jedes Mitarbeiters in Schicht-Token zerlegen.
//  3. Token rundenweise (rotierend) verteilen; große Vollzeit-Schichten zuerst.
//  4. Für jedes Token die beste Kalender-Datum wählen (Score + harte Regeln).
//  5. Früh/Spät anhand der gewünschten Spätschicht-Quote wählen.
//  6. Reparaturlauf: Schichten zwischen Tagen verschieben, um die Tages-
//     nachfrage besser zu treffen (Sollstunden bleiben exakt erhalten).
//
// Harte Regeln, die IMMER eingehalten werden:
//  - genau ein Dienst pro Mitarbeiter und Tag
//  - höchstens 6 aufeinanderfolgende Arbeitstage
//  - Token-Dauer wird nie verändert  => monatliches Soll bleibt exakt
// ============================================================================

import type { Employee, Shift } from "../types";
import {
  DAY_WEIGHTS,
  LATE_SHIFT_RATIOS,
  datesOfMonth,
  parseIsoDate,
  weekdayKeyOf,
  type WeekdayKey,
} from "./demand";
import { getShiftTemplate, type TemplateType } from "./shifts";
import { consecutiveRunLengthWith, seededRandom } from "./consecutive";
import { presenceFromPaid } from "./time";
import {
  effectiveWeekdayKey,
  resolveDay,
  type DayWindow,
  type ResolvedDay,
  type OverrideMap,
  type WorkHoursConfig,
} from "./workHours";
import { publicHolidays } from "./holidays";

export type GenerateInput = {
  year: number;
  month: number; // 1-basiert
  /** Arbeitszeit-Fenster je Wochentag + Feiertag. */
  workHours: WorkHoursConfig;
  /** Ausnahmen für einzelne Daten (geschlossen / abweichende Zeiten). */
  overrides?: OverrideMap;
  employees: Employee[];
  /** Feiertage als ISO-Set; Standard: Rheinland-Pfalz-Feiertage des Jahres. */
  holidays?: Set<string>;
  /** Optionaler Seed; sonst aus Eingabedaten abgeleitet. */
  seed?: string;
};

type DateState = {
  totalPaid: number;
  latePaid: number;
  count: number;
};

type SchedulerState = {
  dates: string[];
  rawTarget: Map<string, number>; // ISO -> rohes Tages-Soll in Minuten
  dateState: Map<string, DateState>;
  worked: Map<string, Set<string>>; // employeeId -> Set<ISO>
  weekendCount: Map<string, number>; // employeeId -> Anzahl Fr/Sa-Schichten
  remaining: Map<string, number>; // employeeId -> noch zu verplanende Minuten
  shifts: Shift[];
  /** Für Nachfrage/Spätquote maßgeblicher Wochentag (Feiertag = Sonntag). */
  effKeyOf: (isoDate: string) => WeekdayKey;
  /** Aufgelöster Tag (geschlossen? + Arbeitszeit-Fenster) für ein Datum. */
  dayOf: (isoDate: string) => ResolvedDay;
  rng: () => number;
  /** true = Schichtlängen mischen; false = immer die längste (Rückfallmodus). */
  varyLengths: boolean;
  /** employeeId -> verbleibende bewusste Kurzschichten in diesem Monat. */
  shortBudget: Map<string, number>;
};

/** Länge des Zeitfensters in Minuten (0 wenn geschlossen). */
function windowLength(day: ResolvedDay): number {
  return day.closed ? 0 : day.window.endMinutes - day.window.startMinutes;
}

let shiftIdCounter = 0;
function nextShiftId(): string {
  shiftIdCounter += 1;
  return `gen-${shiftIdCounter}`;
}

function isWeekend(isoDate: string): boolean {
  const key = weekdayKeyOf(parseIsoDate(isoDate));
  return key === "friday" || key === "saturday";
}

const SHIFT_HOURS_DESC = [9, 8, 7, 6, 5, 4, 3] as const;

/** Längste zulässige Schicht in Stunden (bezahlt, ohne Pause). */
const MAX_SHIFT_HOURS = 9;

/**
 * Erlaubte Schichtlängen je Anstellungsart (Vorgabe des Chefs).
 *
 * Vollzeit stand früher auf 6..9 h. Dadurch konnte eine Vollzeitkraft NIE
 * einen kurzen Dienst bekommen, auch wenn im Monat reichlich Tage übrig
 * waren – der Plan wirkte dadurch mechanisch (fast nur 8/9-h-Schichten).
 * Jetzt sind 4 und 5 h zugelassen; wie oft sie wirklich vorkommen, steuert
 * das Kurzschicht-Budget (siehe SHORT_SHIFT_BUDGET), nicht diese Liste.
 * Die ganz kurze 3-h-Schicht bleibt der Teilzeit vorbehalten.
 */
const ALLOWED_HOURS: Record<Employee["employmentType"], readonly number[]> = {
  VOLLZEIT: [4, 5, 6, 7, 8, 9],
  TEILZEIT: [3, 4, 5, 6, 7, 8, 9],
};

/**
 * Wie viele bewusst KURZE Dienste darf ein Mitarbeiter pro Monat bekommen?
 *
 * Ohne diese Reserve wählt der Scheduler immer die längste Schicht, die das
 * Tempo hält – das Monats-Soll geht auf, aber jeder Monat sieht gleich aus.
 * Mit dem Budget wird ein langer Dienst gelegentlich durch zwei kurze ersetzt
 * (z.B. 8 h -> 4 h + 4 h). Das Budget greift nur, wenn genügend Tage übrig
 * sind; das Monats-Soll bleibt in jedem Fall exakt.
 */
const SHORT_SHIFT_BUDGET = 3;

/** Ab wie vielen freien Reservetagen darf eine Kurzschicht gezogen werden? */
const SHORT_SHIFT_MIN_SLACK = 2;

/** Wahrscheinlichkeit, das Budget bei einer Platzierung einzusetzen. */
const SHORT_SHIFT_CHANCE = 0.35;

/** Alle überhaupt zulässigen Längen – Rückfall, wenn das Fenster eng ist. */
const ALL_HOURS: readonly number[] = [3, 4, 5, 6, 7, 8, 9];

// ── Stoßzeiten (peak windows) ───────────────────────────────────────────────
// Vorgabe des Chefs: mittags 12–13 Uhr und abends 17–19 Uhr müssen JEDERZEIT
// mindestens zwei Leute im Laden stehen – nicht nur an einem Messpunkt,
// sondern über die ganze Spanne.
export type PeakWindow = {
  label: string;
  startMinutes: number;
  endMinutes: number;
  minStaff: number;
};

export const PEAK_WINDOWS: readonly PeakWindow[] = [
  { label: "Mittag", startMinutes: 12 * 60, endMinutes: 13 * 60, minStaff: 2 },
  { label: "Abend", startMinutes: 17 * 60, endMinutes: 19 * 60, minStaff: 2 },
];

/** Wie viele Leute sind zum Zeitpunkt `t` anwesend (Anwesenheit inkl. Pause)? */
function coverageAt(shifts: Shift[], t: number): number {
  let n = 0;
  for (const s of shifts) if (s.startMinutes <= t && s.endMinutes > t) n++;
  return n;
}

/**
 * Kleinste Besetzung im halboffenen Intervall [from, to).
 * Die Besetzung ändert sich nur an Schichtgrenzen, deshalb genügt es, den
 * Anfang und jede Grenze innerhalb des Intervalls zu prüfen.
 */
export function minCoverageOver(shifts: Shift[], from: number, to: number): number {
  const probes = new Set<number>([from]);
  for (const s of shifts) {
    if (s.startMinutes > from && s.startMinutes < to) probes.add(s.startMinutes);
    if (s.endMinutes > from && s.endMinutes < to) probes.add(s.endMinutes);
  }
  let min = Number.POSITIVE_INFINITY;
  for (const t of probes) min = Math.min(min, coverageAt(shifts, t));
  return Number.isFinite(min) ? min : 0;
}

/**
 * Wie viele Personen fehlen an diesem Tag über alle Stoßzeiten zusammen?
 * 0 = beide Spitzen sind ausreichend besetzt. Spitzen, die gar nicht ins
 * Arbeitszeit-Fenster fallen, zählen nicht mit.
 */
export function peakDeficit(shifts: Shift[], window: { startMinutes: number; endMinutes: number }): number {
  let deficit = 0;
  for (const peak of PEAK_WINDOWS) {
    const from = Math.max(peak.startMinutes, window.startMinutes);
    const to = Math.min(peak.endMinutes, window.endMinutes);
    if (to <= from) continue; // Spitze liegt außerhalb der Arbeitszeit
    deficit += Math.max(0, peak.minStaff - minCoverageOver(shifts, from, to));
  }
  return deficit;
}

/**
 * Lässt sich `hours` restlos in Schichten aus `allowed` zerlegen?
 * Nötig, weil z.B. 11 h mit nur 6/7/8-h-Schichten nicht aufgeht – ohne diese
 * Prüfung liefe der Scheduler in eine Sackgasse und das Soll bliebe offen.
 */
const decomposeCache = new Map<string, boolean>();
function canDecompose(hours: number, allowed: readonly number[]): boolean {
  if (hours === 0) return true;
  if (hours < Math.min(...allowed)) return false;

  const key = `${allowed.length}:${hours}`;
  const cached = decomposeCache.get(key);
  if (cached !== undefined) return cached;

  let ok = false;
  for (const h of allowed) {
    if (canDecompose(hours - h, allowed)) {
      ok = true;
      break;
    }
  }
  decomposeCache.set(key, ok);
  return ok;
}

/** Längstmögliche Schicht je Anstellungsart – für die Kapazitätsrechnung. */
const PREFERRED_HOURS: Record<Employee["employmentType"], number> = {
  VOLLZEIT: MAX_SHIFT_HOURS,
  TEILZEIT: MAX_SHIFT_HOURS,
};

/** Größte Schichtlänge (Stunden), deren Anwesenheit noch ins Fenster passt (0 = keine). */
export function maxShiftHoursForWindow(windowMinutes: number): number {
  for (const hours of SHIFT_HOURS_DESC) {
    if (presenceFromPaid(hours * 60) <= windowMinutes) return hours;
  }
  return 0;
}

/**
 * Wählt die Länge (Stunden) der nächsten Schicht eines Mitarbeiters so, dass
 * - sie 3..9 h ist und ins Tagesfenster passt (<= maxHours),
 * - der verbleibende Rest exakt aufteilbar bleibt (0 oder >= 3 h),
 * - Vollzeit möglichst lange, Teilzeit eher kürzere Schichten bekommt.
 * Gibt 0 zurück, wenn an diesem Tag keine gültige Länge möglich ist.
 *
 * Dadurch arbeiten auch Vollzeit-Kräfte an einem „halben Tag" – nur mit einer
 * kürzeren Schicht – und das Monats-Soll bleibt trotzdem exakt.
 */
export function chooseShiftHours(
  remainingMinutes: number,
  maxHours: number,
  employmentType: Employee["employmentType"],
  /** Mindestlänge, um das Soll bis Monatsende noch zu schaffen (Stunden). */
  needHours = MAX_SHIFT_HOURS,
  /** Ohne Zufallsquelle wird deterministisch die kürzeste taugliche gewählt. */
  rng?: () => number,
  /** true = für diese Platzierung bewusst eine kurze Schicht ziehen. */
  preferShort = false,
): number {
  const remainingHours = remainingMinutes / 60;
  const cap = Math.min(MAX_SHIFT_HOURS, maxHours, remainingHours);
  if (cap < 3) return 0;

  // Erlaubte Längen je Anstellungsart (Vorgabe des Chefs): Vollzeit macht keine
  // Kurzschichten, Teilzeit darf die ganze Bandbreite.
  const pick = (allowed: readonly number[]): number[] => {
    const out: number[] = [];
    for (const hours of allowed) {
      if (hours > cap) continue;
      // Der Rest muss mit denselben Längen restlos aufgehen. Bei Vollzeit
      // (6/7/8) sind z.B. 9, 10, 11 oder 17 Stunden Sackgassen.
      if (canDecompose(remainingHours - hours, allowed)) out.push(hours);
    }
    return out;
  };

  // Erst die für die Anstellungsart vorgesehenen Längen. Geht dort nichts –
  // etwa an einem halben Tag, an dem keine 6-h-Schicht mehr hineinpasst –
  // greift die volle Bandbreite, damit auch Vollzeit an dem Tag arbeiten kann.
  let valid = pick(ALLOWED_HOURS[employmentType]);
  if (valid.length === 0) valid = pick(ALL_HOURS);
  if (valid.length === 0) return 0;

  // Früher entschied eine feste Rangliste (Vollzeit 8, Teilzeit 5). Ergebnis:
  // jede Vollzeitschicht war 8 h, jede Teilzeitschicht 5 h – keinerlei
  // Abwechslung, und Teilzeit war faktisch auf 5 h/Tag gedeckelt.
  //
  // Jetzt: unter allen Längen zufällig wählen, aber nur solche, die das Tempo
  // halten. Wer noch viel Soll und wenig Tage hat, bekommt zwangsläufig lange
  // Schichten; wer gut liegt, bekommt Abwechslung.
  const onPace = valid.filter((h) => h >= needHours);

  // Bewusste Kurzschicht: alles UNTER dem nötigen Tempo. Erlaubt ist das nur,
  // wenn der Aufrufer genug Reservetage gezählt hat – sonst reißt das Soll.
  if (rng && preferShort) {
    const short = valid.filter((h) => h < needHours);
    if (short.length > 0) return short[Math.floor(rng() * short.length)];
  }

  const pool = onPace.length > 0 ? onPace : [valid[valid.length - 1]];

  if (!rng) return pool[pool.length - 1];

  // „Bester von zwei Würfen": erzeugt Abwechslung, gewichtet aber zugunsten
  // längerer Schichten. Rein gleichverteilt würden zu viele kurze Schichten
  // fallen und die verfügbaren Tage wären vor Monatsende aufgebraucht.
  const a = pool[Math.floor(rng() * pool.length)];
  const b = pool[Math.floor(rng() * pool.length)];
  return Math.max(a, b);
}

/** Stabile Basisordnung: Vollzeit zuerst, dann nach Id. */
function orderedEmployees(employees: Employee[]): Employee[] {
  return [...employees].sort((a, b) => {
    if (a.employmentType !== b.employmentType) {
      return a.employmentType === "VOLLZEIT" ? -1 : 1;
    }
    return a.id.localeCompare(b.id);
  });
}

function chooseTemplateType(
  state: SchedulerState,
  isoDate: string,
  employmentType: Employee["employmentType"],
): TemplateType {
  const ds = state.dateState.get(isoDate)!;
  const effKey = state.effKeyOf(isoDate);
  const desired = LATE_SHIFT_RATIOS[effKey];
  const currentLateRatio = ds.totalPaid > 0 ? ds.latePaid / ds.totalPaid : 0;

  // Teilzeit tendenziell in Spätschichten. Früher wurde sonntags zusätzlich
  // auf 0,95 hochgezwungen – damit stand am Sonntag praktisch niemand zur
  // Öffnung um 11:00 im Laden. Jetzt gilt die konfigurierte Quote.
  let threshold = desired;
  if (employmentType === "TEILZEIT") threshold += 0.15;

  return currentLateRatio < threshold ? "LATE" : "EARLY";
}

function makeShift(
  state: SchedulerState,
  employee: Employee,
  isoDate: string,
  paidMinutes: number,
): Shift {
  const type = chooseTemplateType(state, isoDate, employee.employmentType);
  const win = state.dayOf(isoDate).window;
  const tpl = getShiftTemplate(paidMinutes / 60, type, win.startMinutes, win.endMinutes);
  return {
    id: nextShiftId(),
    employeeId: employee.id,
    date: isoDate,
    startMinutes: tpl.startMinutes,
    endMinutes: tpl.endMinutes,
    pauseMinutes: tpl.pauseMinutes,
    paidMinutes: tpl.paidMinutes,
    shiftType: tpl.type,
    generated: true,
  };
}

function applyShift(state: SchedulerState, shift: Shift): void {
  const ds = state.dateState.get(shift.date)!;
  ds.totalPaid += shift.paidMinutes;
  if (shift.shiftType === "LATE") ds.latePaid += shift.paidMinutes;
  ds.count += 1;
  state.worked.get(shift.employeeId)!.add(shift.date);
  if (isWeekend(shift.date)) {
    state.weekendCount.set(
      shift.employeeId,
      (state.weekendCount.get(shift.employeeId) ?? 0) + 1,
    );
  }
  state.shifts.push(shift);
}

/**
 * Platziert genau eine Schicht für einen Mitarbeiter: bestes Datum wählen,
 * Schichtlänge an das Tagesfenster anpassen. Gibt true zurück, wenn platziert.
 */
function placeOneShift(state: SchedulerState, employee: Employee): boolean {
  const remaining = state.remaining.get(employee.id)!;
  if (remaining <= 0) return false;

  const worked = state.worked.get(employee.id)!;
  const weekendCount = state.weekendCount.get(employee.id) ?? 0;

  // Erst zählen, wie viele Tage überhaupt noch in Frage kommen. Daraus ergibt
  // sich das nötige Tempo (Stunden je verbleibendem Tag) – ohne das würde die
  // zufällige Längenwahl das Monats-Soll reißen.
  let daysLeft = 0;
  for (const isoDate of state.dates) {
    if (worked.has(isoDate)) continue;
    const day = state.dayOf(isoDate);
    if (day.closed) continue;
    if (maxShiftHoursForWindow(windowLength(day)) === 0) continue;
    if (consecutiveRunLengthWith(worked, isoDate) > 6) continue;
    daysLeft += 1;
  }
  // daysLeft ist eine Obergrenze: greedy belegt nie wirklich JEDEN erlaubten
  // Tag, weil die 6-Tage-Regel Lücken erzwingt. Ohne Sicherheitsabschlag wählt
  // der Zufall zu kurze Schichten und das Soll geht am Monatsende nicht auf.
  const usableDays = Math.max(1, Math.floor(daysLeft * 0.9));
  const needHours = daysLeft > 0 ? Math.ceil(remaining / 60 / usableDays) : MAX_SHIFT_HOURS;

  // Reservetage = wie viele Tage über das absolute Minimum hinaus übrig sind,
  // wenn ab jetzt nur noch die längste Schicht käme. Nur aus dieser Reserve
  // darf eine Kurzschicht bezahlt werden – sonst geht das Soll nicht mehr auf.
  const minDaysNeeded = Math.ceil(remaining / 60 / MAX_SHIFT_HOURS);
  const slackDays = daysLeft - minDaysNeeded;
  const budget = state.shortBudget.get(employee.id) ?? 0;
  // Die Entscheidung fällt EINMAL je Platzierung, nicht je Kandidatentag –
  // sonst hinge sie davon ab, wie viele Tage gerade geprüft werden.
  const preferShort =
    state.varyLengths &&
    budget > 0 &&
    slackDays >= SHORT_SHIFT_MIN_SLACK &&
    state.rng() < SHORT_SHIFT_CHANCE;

  let bestDate: string | null = null;
  let bestHours = 0;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (const isoDate of state.dates) {
    if (worked.has(isoDate)) continue; // max. ein Dienst pro Tag
    const day = state.dayOf(isoDate);
    if (day.closed) continue; // Betriebsruhe -> kein Dienst

    // Längste Schicht, die ins Fenster passt UND den Rest exakt aufteilbar lässt.
    const maxHours = maxShiftHoursForWindow(windowLength(day));
    const hours = chooseShiftHours(
      remaining,
      maxHours,
      employee.employmentType,
      needHours,
      state.varyLengths ? state.rng : undefined,
      preferShort,
    );
    if (hours === 0) continue; // hier passt keine gültige Schicht

    // Harte Regel. Früher gab es hier einen Ausweichtag, der diese Prüfung
    // übersprungen hat – dabei entstanden lautlos Pläne mit bis zu 28
    // Arbeitstagen am Stück. Lieber gar keinen Plan als einen unzulässigen:
    // ohne gültigen Tag bleibt das Soll offen und generateSchedule wirft.
    const runLength = consecutiveRunLengthWith(worked, isoDate);
    if (runLength > 6) continue;

    const ds = state.dateState.get(isoDate)!;
    const deficitHours = (state.rawTarget.get(isoDate)! - ds.totalPaid) / 60;
    const dayWeight = DAY_WEIGHTS[state.effKeyOf(isoDate)];

    const consecutivePenalty = runLength >= 5 ? (runLength - 4) * 8 : 0;
    const weekendPenalty = isWeekend(isoDate) ? weekendCount * 1.5 : 0;

    const jitter = state.rng() * 0.01; // deterministisch (seeded), nur Tie-Break

    const score =
      deficitHours * 10 +
      dayWeight * 3 -
      consecutivePenalty -
      weekendPenalty +
      jitter;

    if (score > bestScore) {
      bestScore = score;
      bestDate = isoDate;
      bestHours = hours;
    }
  }

  if (bestDate === null || bestHours === 0) return false;

  // Budget nur abbuchen, wenn wirklich unter Tempo geplant wurde.
  if (preferShort && bestHours < needHours) {
    state.shortBudget.set(employee.id, budget - 1);
  }

  const shift = makeShift(state, employee, bestDate, bestHours * 60);
  applyShift(state, shift);
  state.remaining.set(employee.id, remaining - shift.paidMinutes);
  return true;
}

/** Kosten eines Tages = |zugewiesene - rohe Soll-Minuten|. */
function dateCost(state: SchedulerState, isoDate: string): number {
  return Math.abs(
    state.dateState.get(isoDate)!.totalPaid - state.rawTarget.get(isoDate)!,
  );
}

function removeShift(state: SchedulerState, shift: Shift): void {
  const ds = state.dateState.get(shift.date)!;
  ds.totalPaid -= shift.paidMinutes;
  if (shift.shiftType === "LATE") ds.latePaid -= shift.paidMinutes;
  ds.count -= 1;
  state.worked.get(shift.employeeId)!.delete(shift.date);
  if (isWeekend(shift.date)) {
    state.weekendCount.set(
      shift.employeeId,
      (state.weekendCount.get(shift.employeeId) ?? 0) - 1,
    );
  }
  const idx = state.shifts.indexOf(shift);
  // Ohne diese Prüfung würde splice(-1, 1) die LETZTE Schicht löschen und das
  // Monats-Soll lautlos reißen.
  if (idx < 0) {
    throw new Error("removeShift: Schicht ist nicht (mehr) im Plan");
  }
  state.shifts.splice(idx, 1);
}

/**
 * Reparaturlauf: verschiebt einzelne Schichten auf andere Tage, wenn dadurch
 * die Tagesnachfrage besser getroffen wird. Ändert nie die Dauer eines Tokens
 * und verletzt nie die harten Regeln => Sollstunden bleiben exakt erhalten.
 */
function repairDemand(state: SchedulerState, employeesById: Map<string, Employee>): void {
  const MAX_PASSES = 6;
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    let improved = false;
    // Kopie, da wir state.shifts während der Iteration verändern.
    for (const shift of [...state.shifts]) {
      const employee = employeesById.get(shift.employeeId)!;
      const from = shift.date;
      const worked = state.worked.get(employee.id)!;

      let bestTarget: string | null = null;
      let bestDelta = -1e-6; // nur echte Verbesserungen

      const oldCostFrom = dateCost(state, from);

      const presence = presenceFromPaid(shift.paidMinutes);
      for (const to of state.dates) {
        if (to === from || worked.has(to)) continue;
        const day = state.dayOf(to);
        if (day.closed || windowLength(day) < presence) continue; // geschlossen / passt nicht
        // 6-Tage-Regel prüfen, als ob "from" bereits entfernt wäre.
        const trial = new Set(worked);
        trial.delete(from);
        if (consecutiveRunLengthWith(trial, to) > 6) continue;

        const oldCostTo = dateCost(state, to);
        const newCostFrom = Math.abs(
          state.dateState.get(from)!.totalPaid - shift.paidMinutes - state.rawTarget.get(from)!,
        );
        const newCostTo = Math.abs(
          state.dateState.get(to)!.totalPaid + shift.paidMinutes - state.rawTarget.get(to)!,
        );
        const delta = newCostFrom + newCostTo - (oldCostFrom + oldCostTo);
        if (delta < bestDelta) {
          bestDelta = delta;
          bestTarget = to;
        }
      }

      if (bestTarget) {
        removeShift(state, shift);
        applyShift(state, makeShift(state, employee, bestTarget, shift.paidMinutes));
        improved = true;
      }
    }
    if (trySwaps(state, employeesById)) improved = true;
    if (!improved) break;
  }
}

/**
 * Tauscht zwei Schichten zwischen zwei Tagen (verschiedene Mitarbeiter).
 *
 * Warum zusätzlich zum Umzug: ein Umzug verschiebt immer den GANZEN Block –
 * bei Schichten von 3..9 h springt das Tages-Soll dadurch grob. Ein Tausch
 * verschiebt nur die Differenz der beiden Längen (z.B. 9 h gegen 7 h = 2 h)
 * und trifft die Tagesnachfrage deutlich feiner.
 *
 * Wie der Umzug ändert der Tausch keine Dauer und verletzt keine harte Regel
 * => jedes Monats-Soll bleibt exakt erhalten.
 */
function trySwaps(state: SchedulerState, employeesById: Map<string, Employee>): boolean {
  let improved = false;
  const snapshot = [...state.shifts];

  for (let i = 0; i < snapshot.length; i++) {
    const a = snapshot[i];
    if (!state.shifts.includes(a)) continue; // schon getauscht
    for (let j = i + 1; j < snapshot.length; j++) {
      const b = snapshot[j];
      if (!state.shifts.includes(b)) continue;
      if (a.date === b.date) continue; // gleicher Tag => keine Wirkung
      if (a.paidMinutes === b.paidMinutes) continue; // gleiche Länge => keine Wirkung
      if (a.employeeId === b.employeeId) continue; // das wäre ein Umzug

      const empA = employeesById.get(a.employeeId)!;
      const empB = employeesById.get(b.employeeId)!;
      const workedA = state.worked.get(empA.id)!;
      const workedB = state.worked.get(empB.id)!;
      // Harte Regel: höchstens ein Dienst pro Mitarbeiter und Tag.
      if (workedA.has(b.date) || workedB.has(a.date)) continue;

      // Die getauschten Längen müssen in das jeweilige Fenster passen.
      const dayA = state.dayOf(a.date);
      const dayB = state.dayOf(b.date);
      if (windowLength(dayA) < presenceFromPaid(b.paidMinutes)) continue;
      if (windowLength(dayB) < presenceFromPaid(a.paidMinutes)) continue;

      // 6-Tage-Regel für beide prüfen, jeweils ohne den eigenen alten Tag.
      const trialA = new Set(workedA);
      trialA.delete(a.date);
      if (consecutiveRunLengthWith(trialA, b.date) > 6) continue;
      const trialB = new Set(workedB);
      trialB.delete(b.date);
      if (consecutiveRunLengthWith(trialB, a.date) > 6) continue;

      const dsA = state.dateState.get(a.date)!;
      const dsB = state.dateState.get(b.date)!;
      const targetA = state.rawTarget.get(a.date)!;
      const targetB = state.rawTarget.get(b.date)!;
      const oldCost =
        Math.abs(dsA.totalPaid - targetA) + Math.abs(dsB.totalPaid - targetB);
      const newCost =
        Math.abs(dsA.totalPaid - a.paidMinutes + b.paidMinutes - targetA) +
        Math.abs(dsB.totalPaid - b.paidMinutes + a.paidMinutes - targetB);
      if (newCost >= oldCost - 1e-6) continue; // nur echte Verbesserungen

      const dateA = a.date;
      const dateB = b.date;
      const paidA = a.paidMinutes;
      const paidB = b.paidMinutes;
      removeShift(state, a);
      removeShift(state, b);
      applyShift(state, makeShift(state, empA, dateB, paidA));
      applyShift(state, makeShift(state, empB, dateA, paidB));
      improved = true;
      break; // a existiert nicht mehr – mit dem nächsten a weitermachen
    }
  }

  return improved;
}

/** Dreht NUR Früh/Spät um. Dauer bleibt gleich => Monats-Soll bleibt exakt. */
function retypeShift(state: SchedulerState, shift: Shift, type: TemplateType): void {
  if (shift.shiftType === type) return;
  const win = state.dayOf(shift.date).window;
  const tpl = getShiftTemplate(shift.paidMinutes / 60, type, win.startMinutes, win.endMinutes);
  const ds = state.dateState.get(shift.date)!;

  if (shift.shiftType === "LATE") ds.latePaid -= shift.paidMinutes;
  shift.startMinutes = tpl.startMinutes;
  shift.endMinutes = tpl.endMinutes;
  shift.pauseMinutes = tpl.pauseMinutes;
  shift.shiftType = tpl.type;
  if (tpl.type === "LATE") ds.latePaid += shift.paidMinutes;
}

/**
 * Nachlauf über die Schichttypen. Zwei Ziele, in dieser Reihenfolge:
 *  1. Die Spätquote je Tag näher an den Sollwert bringen (vorher schwankte
 *     sie stark, obwohl für alle ruhigen Tage derselbe Wert gilt).
 *  2. Wichtiger als jede Quote: an jedem offenen Tag muss jemand aufsperren
 *     UND jemand zusperren. Vorher kam es vor, dass um 11:00 niemand da war.
 * Es wird ausschließlich der Typ gedreht, nie die Dauer – das Soll bleibt exakt.
 */
function balanceShiftTypes(state: SchedulerState): void {
  for (const isoDate of state.dates) {
    const day = state.dayOf(isoDate);
    if (day.closed) continue;

    const onDay = state.shifts.filter((s) => s.date === isoDate);
    if (onDay.length === 0) continue;

    const ds = state.dateState.get(isoDate)!;
    const desired = LATE_SHIFT_RATIOS[state.effKeyOf(isoDate)];

    // 1. Quote annähern: jeweils die Schicht drehen, die am meisten hilft.
    for (let step = 0; step < onDay.length * 2; step++) {
      if (ds.totalPaid === 0) break;
      let best: Shift | null = null;
      let bestDiff = Math.abs(ds.latePaid / ds.totalPaid - desired);
      for (const s of onDay) {
        const late =
          s.shiftType === "LATE" ? ds.latePaid - s.paidMinutes : ds.latePaid + s.paidMinutes;
        const diff = Math.abs(late / ds.totalPaid - desired);
        if (diff < bestDiff - 1e-9) {
          bestDiff = diff;
          best = s;
        }
      }
      if (!best) break;
      retypeShift(state, best, best.shiftType === "LATE" ? "EARLY" : "LATE");
    }

    // 2. Öffnen/Schließen sichern. Mit nur einer Schicht am Tag geht beides
    //    nicht – dann bleibt es bei der Quote-Entscheidung.
    if (onDay.length < 2) continue;

    const shortestOf = (list: Shift[]) =>
      list.length === 0 ? null : list.reduce((a, b) => (a.paidMinutes <= b.paidMinutes ? a : b));

    let flipped: Shift | null = null;
    if (!onDay.some((s) => s.startMinutes === day.window.startMinutes)) {
      const victim = shortestOf(onDay.filter((s) => s.shiftType === "LATE"));
      if (victim) {
        retypeShift(state, victim, "EARLY");
        flipped = victim;
      }
    }
    if (!onDay.some((s) => s.endMinutes === day.window.endMinutes)) {
      const victim = shortestOf(
        onDay.filter((s) => s.shiftType === "EARLY" && s !== flipped),
      );
      if (victim) retypeShift(state, victim, "LATE");
    }

    // 3. Stoßzeiten absichern (12–13 und 17–19 Uhr, je mindestens 2 Personen).
    //    Vorher deckte dieser Schritt nur einen Messpunkt zur Mittagszeit ab;
    //    der Abend war ungeprüft. Jetzt wird über beide Spannen die KLEINSTE
    //    Besetzung geprüft, nicht ein einzelner Zeitpunkt.
    //
    //    Zur Mechanik: Frühschichten hängen am Öffnen, Spätschichten am
    //    Schließen. Damit deckt jede Frühschicht den Mittag und jede
    //    Spätschicht den Abend; beide Spitzen zugleich schafft nur eine lange
    //    Schicht (8/9 h). Gedreht wird ausschließlich der Typ, nie die Dauer –
    //    das Monats-Soll bleibt exakt. Reicht die Tagesmasse nicht aus, bleibt
    //    eine Lücke bestehen; sie ist in analyzeSchedule sichtbar.
    const hasOpener = () => onDay.some((s) => s.startMinutes === day.window.startMinutes);
    const hasCloser = () => onDay.some((s) => s.endMinutes === day.window.endMinutes);

    for (let guard = 0; guard < onDay.length * 3; guard++) {
      const deficit = peakDeficit(onDay, day.window);
      if (deficit === 0) break;

      let best: Shift | null = null;
      let bestDeficit = deficit;
      for (const s of onDay) {
        // shiftType kennt zusätzlich "CUSTOM"; erzeugte Schichten sind immer
        // EARLY oder LATE. Für die Probe wird alles andere wie EARLY behandelt.
        const back: TemplateType = s.shiftType === "LATE" ? "LATE" : "EARLY";
        const target: TemplateType = back === "LATE" ? "EARLY" : "LATE";
        retypeShift(state, s, target);
        // Öffnen/Schließen darf die Spitzenreparatur nicht kaputt machen.
        const ok = hasOpener() && hasCloser();
        const next = ok ? peakDeficit(onDay, day.window) : Number.POSITIVE_INFINITY;
        retypeShift(state, s, back);
        if (next < bestDeficit) {
          bestDeficit = next;
          best = s;
        }
      }

      if (!best) break; // keine Drehung verbessert noch etwas
      retypeShift(state, best, best.shiftType === "LATE" ? "EARLY" : "LATE");
    }

    // 4. Reicht Drehen nicht, die Dienste im Fenster neu ANORDNEN.
    layoutDayForPeaks(day.window, onDay);
  }
}

/** Verschiebt einen Dienst auf eine neue Startzeit; Dauer bleibt gleich. */
function moveShiftTo(shift: Shift, startMinutes: number): void {
  const presence = shift.endMinutes - shift.startMinutes;
  shift.startMinutes = startMinutes;
  shift.endMinutes = startMinutes + presence;
}

/**
 * Startzeiten, an denen ein Dienst überhaupt etwas Nützliches beiträgt:
 * aufsperren, zusperren, oder eine Stoßzeit vollständig abdecken.
 */
function candidateStarts(shift: Shift, window: DayWindow): number[] {
  const presence = shift.endMinutes - shift.startMinutes;
  const latest = window.endMinutes - presence;
  if (latest < window.startMinutes) return [window.startMinutes];

  const out = new Set<number>([window.startMinutes, latest]);
  for (const peak of PEAK_WINDOWS) {
    const from = Math.max(peak.startMinutes, window.startMinutes);
    const to = Math.min(peak.endMinutes, window.endMinutes);
    if (to <= from || presence < to - from) continue;
    const lo = Math.max(window.startMinutes, to - presence);
    const hi = Math.min(from, latest);
    if (lo <= hi) {
      out.add(lo);
      out.add(hi);
    }
  }
  return [...out].sort((a, b) => a - b);
}

/**
 * Ordnet die Dienste eines Tages so an, dass beide Stoßzeiten besetzt sind
 * und trotzdem jemand auf- und zusperrt. Dauer und Pause bleiben unangetastet
 * => das Monats-Soll bleibt exakt erhalten.
 *
 * Warum nicht einfach Dienst für Dienst verschieben: das bleibt in einem
 * lokalen Optimum stecken. Beispiel 27.07. – eine 8-h-Frühschicht (10:00 bis
 * 18:30) und zwei 5-h-Spätschichten. Mittags steht nur einer im Laden. Wer
 * die Frühschicht verschieben will, nimmt dem Tag den Aufsperrer, also wird
 * der Zug verworfen; erst wenn VORHER eine Spätschicht auf 10:00 rückt, geht
 * es auf. Ein einzelner Zug kommt dort nie hin.
 *
 * Deshalb: Auf- und Zusperrer werden zuerst festgelegt (alle Paare werden
 * durchprobiert), der Rest wird danach frei eingeplant.
 */
function layoutDayForPeaks(window: DayWindow, onDay: Shift[]): void {
  if (onDay.length < 2) return;
  if (peakDeficit(onDay, window) === 0) return; // schon gut

  const starts = onDay.map((s) => s.startMinutes);
  const restore = (list: number[]) => onDay.forEach((s, i) => moveShiftTo(s, list[i]));

  let bestStarts = [...starts];
  let bestDeficit = peakDeficit(onDay, window);

  for (let i = 0; i < onDay.length && bestDeficit > 0; i++) {
    for (let j = 0; j < onDay.length && bestDeficit > 0; j++) {
      if (i === j) continue;
      restore(starts);

      // i sperrt auf, j sperrt zu.
      const closerStart = window.endMinutes - (onDay[j].endMinutes - onDay[j].startMinutes);
      if (closerStart < window.startMinutes) continue;
      moveShiftTo(onDay[i], window.startMinutes);
      moveShiftTo(onDay[j], closerStart);

      // Alle übrigen Dienste greedy dorthin, wo sie am meisten helfen.
      for (let k = 0; k < onDay.length; k++) {
        if (k === i || k === j) continue;
        let pick = onDay[k].startMinutes;
        let pickDeficit = Number.POSITIVE_INFINITY;
        for (const c of candidateStarts(onDay[k], window)) {
          moveShiftTo(onDay[k], c);
          const d = peakDeficit(onDay, window);
          if (d < pickDeficit) {
            pickDeficit = d;
            pick = c;
          }
        }
        moveShiftTo(onDay[k], pick);
      }

      const deficit = peakDeficit(onDay, window);
      if (deficit < bestDeficit) {
        bestDeficit = deficit;
        bestStarts = onDay.map((s) => s.startMinutes);
      }
    }
  }

  restore(bestStarts);
}

/**
 * Obergrenze für EINEN Mitarbeiter: wie viele Tage und Stunden im Monat
 * überhaupt möglich sind. Greedy von vorn – an jedem offenen Tag arbeiten,
 * solange die 6-Tage-Regel es zulässt; danach zwingend ein freier Tag.
 * Das ist das Maximum, mehr geht rein rechnerisch nicht.
 */
function monthCapacity(
  dates: string[],
  dayOf: (isoDate: string) => ResolvedDay,
  capHours = MAX_SHIFT_HOURS,
): { openDays: number; maxDays: number; maxMinutes: number } {
  let openDays = 0;
  let maxDays = 0;
  let maxMinutes = 0;
  let run = 0;

  for (const isoDate of dates) {
    const day = dayOf(isoDate);
    if (day.closed) {
      run = 0; // geschlossener Tag zählt als Pause
      continue;
    }
    openDays += 1;
    const hours = Math.min(maxShiftHoursForWindow(windowLength(day)), capHours);
    if (hours < 3) continue; // Fenster zu kurz für die kürzeste Schicht (3 h)

    if (run >= 6) {
      run = 0; // Pflicht-Ruhetag
      continue;
    }
    run += 1;
    maxDays += 1;
    maxMinutes += hours * 60;
  }

  return { openDays, maxDays, maxMinutes };
}

/** Fehlermeldung, die auch sagt WARUM es nicht aufgeht. */
function buildUnmetMessage(
  state: SchedulerState,
  unmet: Employee[],
  dates: string[],
  dayOf: (isoDate: string) => ResolvedDay,
): string {
  const full = monthCapacity(dates, dayOf, PREFERRED_HOURS.VOLLZEIT);


  const missing = unmet
    .map((e) => {
      const short = state.remaining.get(e.id)!;
      const done = (e.targetMinutes - short) / 60;
      const capMin = full.maxMinutes;
      const overCap = e.targetMinutes > capMin ? ` — vượt trần ${capMin / 60}h` : "";
      return `${e.name} chỉ xếp được ${done}h / ${e.targetMinutes / 60}h${overCap}`;
    })
    .join("; ");

  if (full.maxDays === 0) {
    return (
      `Không xếp được ca nào (${missing}). ` +
      `Tháng này có ${full.openDays} ngày mở cửa nhưng khung giờ làm quá ngắn — ` +
      `không đủ cho cả ca ngắn nhất (3h). Hãy nới khung giờ làm ở tab Cài đặt.`
    );
  }

  // maxMinutes ist eine OBERGRENZE (jeden erlaubten Tag die längste Schicht).
  // Der greedy Scheduler erreicht sie nicht immer – daher als Decke formulieren.
  return (
    `Không xếp đủ định mức: ${missing}. ` +
    `Tháng này có ${full.openDays} ngày mở cửa; do quy tắc tối đa 6 ngày làm ` +
    `liên tiếp, mỗi người làm được nhiều nhất ${full.maxDays} ngày — trần lý ` +
    `thuyết ${full.maxMinutes / 60}h/người, thực tế thấp hơn. ` +
    `Hãy giảm định mức, nới khung giờ làm, bớt ngày đóng cửa, hoặc thêm người.`
  );
}

/**
 * Hauptfunktion: erzeugt die Schichten für den Monat.
 * Gibt eine neue Liste generierter Shifts zurück (verändert keine Eingaben).
 */
export function generateSchedule(input: GenerateInput): Shift[] {
  shiftIdCounter = 0;
  const { year, month, workHours, employees } = input;
  const holidays = input.holidays ?? publicHolidays(year);
  const overrides = input.overrides ?? {};

  const effKeyOf = (isoDate: string): WeekdayKey => effectiveWeekdayKey(isoDate, holidays);
  const dayOf = (isoDate: string): ResolvedDay => resolveDay(workHours, isoDate, holidays, overrides);
  // Nachfrage-Gewicht: geschlossene Tage tragen 0 (bekommen keine Stunden).
  const weightOf = (isoDate: string): number =>
    dayOf(isoDate).closed ? 0 : DAY_WEIGHTS[effKeyOf(isoDate)];

  const dates = datesOfMonth(year, month);
  const totalTargetMin = employees.reduce((sum, e) => sum + e.targetMinutes, 0);
  const totalWeight = dates.reduce((sum, d) => sum + weightOf(d), 0);

  const rawTarget = new Map<string, number>();
  for (const d of dates) {
    rawTarget.set(d, totalWeight > 0 ? (totalTargetMin * weightOf(d)) / totalWeight : 0);
  }

  const dateState = new Map<string, DateState>();
  const worked = new Map<string, Set<string>>();
  const weekendCount = new Map<string, number>();
  const remaining = new Map<string, number>();
  for (const d of dates) dateState.set(d, { totalPaid: 0, latePaid: 0, count: 0 });
  for (const e of employees) {
    worked.set(e.id, new Set());
    weekendCount.set(e.id, 0);
    remaining.set(e.id, e.targetMinutes);
  }

  const seed =
    input.seed ??
    `${year}-${month}-${employees.map((e) => `${e.id}:${e.targetMinutes}`).join("|")}`;

  const employeesById = new Map(employees.map((e) => [e.id, e] as const));
  const ordered = orderedEmployees(employees);
  const n = ordered.length;

  /**
   * Ein kompletter Belegungsversuch. varyLengths=true mischt die Schichtlängen
   * (4..8 h statt immer die längste); das ist schöner, kann aber bei knappem
   * Soll die Tage aufbrauchen. Deshalb gibt es den zweiten, strengen Versuch.
   */
  function attempt(varyLengths: boolean, salt = ""): SchedulerState {
    shiftIdCounter = 0;
    const st: SchedulerState = {
      dates,
      rawTarget,
      dateState: new Map(dates.map((d) => [d, { totalPaid: 0, latePaid: 0, count: 0 }])),
      worked: new Map(employees.map((e) => [e.id, new Set<string>()])),
      weekendCount: new Map(employees.map((e) => [e.id, 0])),
      remaining: new Map(employees.map((e) => [e.id, e.targetMinutes])),
      shifts: [],
      effKeyOf,
      dayOf,
      rng: seededRandom(seed + salt),
      varyLengths,
      shortBudget: new Map(employees.map((e) => [e.id, SHORT_SHIFT_BUDGET])),
    };

    // Rundenweise, rotierend platzieren: pro Runde eine Schicht je Mitarbeiter,
    // bis jedes Monats-Soll exakt erreicht ist.
    for (let round = 0; ; round++) {
      if (ordered.every((e) => st.remaining.get(e.id)! <= 0)) break;
      let progress = false;
      for (let i = 0; i < n; i++) {
        const emp = ordered[(i + round) % n];
        if (st.remaining.get(emp.id)! <= 0) continue;
        if (placeOneShift(st, emp)) progress = true;
      }
      if (!progress) break; // keine Platzierung mehr möglich
    }
    return st;
  }

  const incomplete = (st: SchedulerState) =>
    employees.some((e) => st.remaining.get(e.id)! > 0);

  // Mehrere Anläufe mit gemischten Längen (jeweils anderer Zufallsstrom).
  // Klappt keiner, wird streng die längste Schicht genommen – damit ist das
  // Ergebnis nie schlechter als ohne Abwechslung.
  let state = attempt(true);
  for (let k = 1; k < 5 && incomplete(state); k++) {
    state = attempt(true, `#${k}`);
  }
  if (incomplete(state)) state = attempt(false);

  const unmet = employees.filter((e) => state.remaining.get(e.id)! > 0);
  if (unmet.length > 0) {
    throw new Error(buildUnmetMessage(state, unmet, dates, dayOf));
  }

  repairDemand(state, employeesById);
  balanceShiftTypes(state);

  // Stabil sortieren: nach Datum, dann Startzeit, dann Mitarbeiter.
  state.shifts.sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      a.startMinutes - b.startMinutes ||
      a.employeeId.localeCompare(b.employeeId),
  );
  return state.shifts;
}
