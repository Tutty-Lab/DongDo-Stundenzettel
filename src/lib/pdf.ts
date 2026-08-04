// ============================================================================
// PDF-Export der Stundenzettel. Jede .stundenzettel-page wird als Bild
// aufgenommen und auf eine A4-Seite gelegt – dadurch sieht die PDF exakt so
// aus wie der Ausdruck, ohne das Layout ein zweites Mal pflegen zu müssen.
// ============================================================================

import { jsPDF } from "jspdf";
import html2canvas from "html2canvas";

const A4_WIDTH_MM = 210;
const A4_HEIGHT_MM = 297;

/** Dateiname säubern: Umlaute/Akzente weg, nur unbedenkliche Zeichen behalten. */
export function safeFileName(text: string): string {
  const plain = text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // Akzente entfernen: "Tuấn" -> "Tuan"
    .replace(/đ/g, "d") // đ
    .replace(/Đ/g, "D"); // Đ
  return plain.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "") || "Stundenzettel";
}

/**
 * Rendert die übergebenen Elemente in eine PDF (ein Element = eine A4-Seite)
 * und stößt den Download an. Die Elemente müssen sichtbar gerendert sein –
 * display:none kann html2canvas nicht aufnehmen (deshalb die Offscreen-Bühne).
 */
export async function elementsToPdf(elements: HTMLElement[], filename: string): Promise<void> {
  if (elements.length === 0) return;

  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });

  for (let i = 0; i < elements.length; i++) {
    const canvas = await html2canvas(elements[i], {
      scale: 2, // schärfer als 1:1, aber noch vertretbare Dateigröße
      backgroundColor: "#ffffff",
      logging: false,
    });

    // Seitenverhältnis beibehalten und in die A4-Seite einpassen.
    const ratio = canvas.height / canvas.width;
    let width = A4_WIDTH_MM;
    let height = width * ratio;
    if (height > A4_HEIGHT_MM) {
      height = A4_HEIGHT_MM;
      width = height / ratio;
    }

    if (i > 0) doc.addPage();
    doc.addImage(
      canvas.toDataURL("image/jpeg", 0.92),
      "JPEG",
      (A4_WIDTH_MM - width) / 2,
      0,
      width,
      height,
    );
  }

  doc.save(filename);
}
