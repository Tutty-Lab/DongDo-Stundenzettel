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
    // Vollzeit darf 4..9 h. Bei 11 h Rest geht 8 nicht auf (Rest 3 ist nur
    // für Teilzeit gültig), 7 dagegen schon: 7 + 4 = 11.
    expect(chooseShiftHours(11 * 60, 8, "VOLLZEIT")).toBe(7);
    // Rest von 8 h: 8 ist ok (Rest 0).
    expect(chooseShiftHours(8 * 60, 8, "VOLLZEIT")).toBe(8);
  });

  it("hält den Rest auch in LANGEN Längen aufteilbar, wenn die Stoßzeit sie braucht", () => {
    // peakHours = 8 verlangt eine Schicht >= 8 h UND einen Rest, der sich
    // ebenfalls aus 8/9-h-Schichten zusammensetzen lässt.
    // 120 h = 15 x 8 h  => 8 ist zulässig.
    expect(chooseShiftHours(120 * 60, 9, "TEILZEIT", 8, undefined, 8)).toBeGreaterThanOrEqual(8);
    // 13 h lässt sich NICHT in 8/9-h-Schichten zerlegen. Dann greift die
    // normale Auswahl – der Rest muss aber weiterhin aufgehen: 9 + 4.
    const h = chooseShiftHours(13 * 60, 9, "VOLLZEIT", 8, undefined, 8);
    expect(h).toBe(9);
    expect(13 - h).toBe(4); // gültige Vollzeit-Länge, das Soll geht auf
  });

  it("gibt 0 zurück, wenn keine gültige Länge möglich ist", () => {
    expect(chooseShiftHours(176 * 60, 2, "VOLLZEIT")).toBe(0); // Fenster < 3 h
    expect(chooseShiftHours(2 * 60, 8, "TEILZEIT")).toBe(0); // Rest zu klein (< 3 h)
  });
});
