import { describe, expect, it } from "vitest";
import { chooseShiftHours, maxShiftHoursForWindow } from "../scheduler";

describe("maxShiftHoursForWindow", () => {
  it("rechnet mit Anwesenheit inkl. Pause, nicht mit bezahlter Zeit", () => {
    // Anwesenheit: 3h=180, 5h=300, 6h=390, 7h=450, 8h=510, 9h=600.
    expect(maxShiftHoursForWindow(10 * 60)).toBe(9); // 10:00–20:00 fasst die 9-h-Schicht exakt
    expect(maxShiftHoursForWindow(10 * 60 - 1)).toBe(8); // knapp zu kurz für 9 h
    expect(maxShiftHoursForWindow(510)).toBe(8); // exakt die Anwesenheit der 8-h-Schicht
    expect(maxShiftHoursForWindow(509)).toBe(7);
    expect(maxShiftHoursForWindow(450)).toBe(7);
    expect(maxShiftHoursForWindow(449)).toBe(6);
    expect(maxShiftHoursForWindow(390)).toBe(6);
    expect(maxShiftHoursForWindow(389)).toBe(5); // ab hier pausenfrei
    expect(maxShiftHoursForWindow(5 * 60)).toBe(5);
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

  it("Vollzeit nimmt an normalen Tagen die längste passende Schicht", () => {
    expect(chooseShiftHours(176 * 60, 9, "VOLLZEIT")).toBe(9);
    expect(chooseShiftHours(176 * 60, 8, "VOLLZEIT")).toBe(8);
  });

  it("hält den Rest exakt aufteilbar", () => {
    // Rest von 11 h: 8 ginge nicht, weil 3 h für Vollzeit keine gültige Länge
    // ist (3 h bleibt der Teilzeit vorbehalten). 7 + 4 geht auf.
    expect(chooseShiftHours(11 * 60, 8, "VOLLZEIT")).toBe(7);
    // Rest von 8 h: 8 ist ok (Rest 0).
    expect(chooseShiftHours(8 * 60, 8, "VOLLZEIT")).toBe(8);
  });

  it("gibt 0 zurück, wenn keine gültige Länge möglich ist", () => {
    expect(chooseShiftHours(176 * 60, 2, "VOLLZEIT")).toBe(0); // Fenster < 3 h
    expect(chooseShiftHours(2 * 60, 8, "TEILZEIT")).toBe(0); // Rest zu klein (< 3 h)
  });
});
