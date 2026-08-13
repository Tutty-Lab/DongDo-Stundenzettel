import { describe, expect, it } from "vitest";
import {
  calculatePaidMinutes,
  calculatePause,
  minutesToDecimalHours,
  minutesToTime,
  presenceFromPaid,
  timeToMinutes,
} from "../time";

describe("timeToMinutes / minutesToTime", () => {
  it("konvertiert Uhrzeiten in Minuten", () => {
    expect(timeToMinutes("00:00")).toBe(0);
    expect(timeToMinutes("13:30")).toBe(810);
    expect(timeToMinutes("22:00")).toBe(1320);
  });

  it("ist invers zu minutesToTime", () => {
    for (const t of ["10:00", "13:30", "17:45", "22:00"]) {
      expect(minutesToTime(timeToMinutes(t))).toBe(t);
    }
  });

  it("wirft bei ungültigem Format", () => {
    expect(() => timeToMinutes("25:00")).toThrow();
    expect(() => timeToMinutes("abc")).toThrow();
  });
});

describe("calculatePause", () => {
  it("kurze Schichten (3..7 h) bleiben ohne Pause", () => {
    expect(calculatePause(3 * 60)).toBe(0);
    expect(calculatePause(6 * 60)).toBe(0);
    expect(calculatePause(7 * 60)).toBe(0);
    // knapp unter 8 h zählt noch als kurz
    expect(calculatePause(7 * 60 + 59)).toBe(0);
  });
  it("lange Schichten (8 h und 9 h) bekommen 60 Minuten", () => {
    expect(calculatePause(8 * 60)).toBe(60);
    expect(calculatePause(9 * 60)).toBe(60);
  });
});

describe("calculatePaidMinutes / presenceFromPaid", () => {
  it("berechnet bezahlte Minuten aus Beginn/Ende/Pause", () => {
    // 12:00-20:00, keine Pause => 8 h
    expect(calculatePaidMinutes(720, 1200, 0)).toBe(480);
    // 16:00-20:00, keine Pause => 4 h
    expect(calculatePaidMinutes(960, 1200, 0)).toBe(240);
    // 10:00-19:00 mit 60 min Pause => 8 h bezahlt
    expect(calculatePaidMinutes(600, 1140, 60)).toBe(480);
  });
  it("presence = paid + Pause", () => {
    expect(presenceFromPaid(180)).toBe(180); // 3 h, keine Pause
    expect(presenceFromPaid(240)).toBe(240); // 4 h, keine Pause
    expect(presenceFromPaid(420)).toBe(420); // 7 h, keine Pause
    expect(presenceFromPaid(480)).toBe(540); // 8 h + 60 min = 9 h Anwesenheit
    expect(presenceFromPaid(540)).toBe(600); // 9 h + 60 min = 10 h Anwesenheit
  });
});

describe("minutesToDecimalHours", () => {
  it("formatiert deutsch mit Komma", () => {
    expect(minutesToDecimalHours(480)).toBe("8,00");
    expect(minutesToDecimalHours(450)).toBe("7,50");
  });
});
