import { describe, expect, it } from "vitest";
import { chooseShiftHours, maxShiftHoursForWindow } from "../scheduler";

describe("maxShiftHoursForWindow", () => {
  it("liefert die längste passende Schicht fürs Zeitfenster (ohne Pause)", () => {
    expect(maxShiftHoursForWindow(10 * 60)).toBe(8); // 10:00–20:00
    expect(maxShiftHoursForWindow(8 * 60)).toBe(8); // exakt 8 h Anwesenheit passt
    expect(maxShiftHoursForWindow(8 * 60 - 1)).toBe(7); // knapp zu kurz für die 8-h-Schicht
    expect(maxShiftHoursForWindow(5 * 60)).toBe(5); // halber Tag
    expect(maxShiftHoursForWindow(3 * 60)).toBe(3); // kurze 3-h-Schicht passt
    expect(maxShiftHoursForWindow(3 * 60 - 1)).toBe(0); // zu kurz für 3 h
  });
});

describe("chooseShiftHours – Schicht passt sich dem Tag an", () => {
  it("Vollzeit arbeitet an einem halben Tag eine KÜRZERE Schicht (nicht frei)", () => {
    // 5,5 h Fenster => max 5 h. Rest bleibt exakt aufteilbar.
    const hours = chooseShiftHours(176 * 60, 5, "VOLLZEIT");
    expect(hours).toBeGreaterThanOrEqual(4);
    expect(hours).toBeLessThanOrEqual(5);
  });

  it("Vollzeit nimmt an normalen Tagen die 8-h-Schicht", () => {
    expect(chooseShiftHours(176 * 60, 8, "VOLLZEIT")).toBe(8);
  });

  it("hält den Rest exakt aufteilbar", () => {
    // Rest von 11 h: 8 ist ok, weil der Rest 3 h jetzt eine gültige Schicht ist.
    expect(chooseShiftHours(11 * 60, 8, "VOLLZEIT")).toBe(8);
    // Rest von 8 h: 8 ist ok (Rest 0).
    expect(chooseShiftHours(8 * 60, 8, "VOLLZEIT")).toBe(8);
  });

  it("gibt 0 zurück, wenn keine gültige Länge möglich ist", () => {
    expect(chooseShiftHours(176 * 60, 2, "VOLLZEIT")).toBe(0); // Fenster < 3 h
    expect(chooseShiftHours(2 * 60, 8, "TEILZEIT")).toBe(0); // Rest zu klein (< 3 h)
  });
});
