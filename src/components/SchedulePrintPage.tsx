import type { Schedule, Shift } from "../types";
import { parseIsoDate, WEEKDAY_LABELS_DE, weekdayKeyOf } from "../lib/demand";
import { minutesToShortHours, minutesToTime } from "../lib/time";
import { publicHolidayNames } from "../lib/holidays";
import { isDayClosed } from "../lib/workHours";
import { publicHolidays } from "../lib/holidays";
import { format } from "date-fns";

/**
 * Druckbarer Dienstplan für einen Zeitraum (ganzer Monat oder eine Woche).
 *
 * Zeilen sind Tage, Spalten die Mitarbeiter – nicht umgekehrt. Der Laden hat
 * eine Handvoll Beschäftigte, aber bis zu 31 Tage; so passt der Monatsplan
 * hochkant auf A4, ohne dass etwas abgeschnitten wird.
 */
export function SchedulePrintPage({
  schedule,
  dates,
  title,
}: {
  schedule: Schedule;
  dates: string[];
  title: string;
}) {
  const byKey = new Map<string, Shift>();
  for (const s of schedule.shifts) byKey.set(`${s.employeeId}#${s.date}`, s);

  const holidays = publicHolidays(schedule.year);
  const holidayNames = publicHolidayNames(schedule.year);
  const overrides = Object.fromEntries(schedule.dateOverrides.map((o) => [o.date, o]));

  return (
    <div className="stundenzettel-page bg-white text-slate-900 mx-auto max-w-[210mm] p-6 text-[12px]">
      <div className="flex items-start justify-between border-b-2 border-slate-800 pb-2 mb-3">
        <div>
          <h2 className="text-xl font-bold tracking-tight">Dienstplan</h2>
          <p className="text-slate-600">{schedule.companyName || "—"}</p>
          {schedule.address && <p className="text-slate-500 text-[11px]">{schedule.address}</p>}
        </div>
        <div className="text-right text-slate-600">
          <div className="font-medium">{title}</div>
        </div>
      </div>

      <table className="w-full border-collapse text-[11px]">
        <thead>
          <tr className="bg-slate-100">
            <th className="border border-slate-300 px-2 py-1 text-left font-semibold">Datum</th>
            <th className="border border-slate-300 px-2 py-1 text-left font-semibold">Wochentag</th>
            {schedule.employees.map((e) => (
              <th key={e.id} className="border border-slate-300 px-2 py-1 text-center font-semibold">
                {e.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {dates.map((d) => {
            const closed = isDayClosed(schedule.workHours, d, holidays, overrides);
            const holiday = holidayNames.get(d);
            const wd = WEEKDAY_LABELS_DE[weekdayKeyOf(parseIsoDate(d))];
            return (
              <tr key={d} className={closed ? "bg-slate-50" : ""}>
                <td className="border border-slate-300 px-2 py-[3px]">
                  {format(parseIsoDate(d), "dd.MM.yyyy")}
                </td>
                <td className="border border-slate-300 px-2 py-[3px]">
                  {wd}
                  {holiday && <span className="text-slate-500"> · {holiday}</span>}
                </td>
                {schedule.employees.map((e) => {
                  const s = byKey.get(`${e.id}#${d}`);
                  return (
                    <td key={e.id} className="border border-slate-300 px-2 py-[3px] text-center">
                      {s ? (
                        <>
                          <div>
                            {minutesToTime(s.startMinutes)}–{minutesToTime(s.endMinutes)}
                          </div>
                          <div className="text-[10px] text-slate-500">
                            {minutesToShortHours(s.paidMinutes)}
                            {s.pauseMinutes > 0 && ` · P ${s.pauseMinutes}`}
                          </div>
                        </>
                      ) : (
                        <span className="text-slate-400">{closed ? "—" : "frei"}</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>

      <div className="mt-8 grid grid-cols-2 gap-8 text-[11px]">
        <div className="border-t border-slate-500 pt-1 mt-8 text-slate-600">
          Unterschrift Arbeitgeber
        </div>
        <div className="border-t border-slate-500 pt-1 mt-8 text-slate-600">Datum</div>
      </div>
    </div>
  );
}
