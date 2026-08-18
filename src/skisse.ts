/**
 * Kundeskisse i A4 som vektor.
 *
 * Denne brukes internt og som arkiv. Versjonen kunden far, gar gjennom
 * skisse_kunde.ts og er brent flat med vannmerke.
 *
 * Alle motiver i samme malestokk, med mal og antall. Rode advarsler der
 * motivet ikke lar seg skjaere i bestilt storrelse. Disclaimer hentet
 * uendret fra Informativs egen utkastmal.
 *
 * Er folien hvit, legges bakgrunnen i CMYK 0/0/0/30 slik at motivene synes.
 * Foliekoder star med vilje ikke pa skissen. De er produksjonsinformasjon.
 */
import { PDFDocument, PDFOperator, StandardFonts, cmyk } from "pdf-lib";
import { A4, DISCLAIMER, MARGIN, MM, beregnLayout } from "./skisselayout.ts";
import type { Felt, Layout, SkisseMotiv } from "./skisselayout.ts";

export type { Felt, SkisseMotiv } from "./skisselayout.ts";

/**
 * pdf-lib har ingen apning for a skrive rae operatorer. Et PDFOperator
 * skriver navnet sitt ordrett ut i innholdsstrommen, sa vi legger hele
 * kodesnutten i navnet.
 */
const raa = (s: string) => PDFOperator.of(s as any);

export interface SkisseResultat {
  bytes: Uint8Array;
  layout: Layout;
}

export async function byggSkisse(
  motiver: SkisseMotiv[], jobb: string, felt: Felt,
  graaBunn: boolean, disclaimerBilde: string | Uint8Array | null
): Promise<SkisseResultat> {
  const L = beregnLayout(motiver, felt);
  const doc = await PDFDocument.create();
  const side = doc.addPage([A4.b * MM, A4.h * MM]);
  const helv = await doc.embedFont(StandardFonts.Helvetica);
  const fet = await doc.embedFont(StandardFonts.HelveticaBold);

  const sort = cmyk(0, 0, 0, 1);
  const damp = cmyk(0, 0, 0, 0.55);
  const rod = cmyk(0, 1, 1, 0);

  if (graaBunn) {
    side.drawRectangle({
      x: 0, y: DISCLAIMER.topp + 4, width: A4.b * MM,
      height: A4.h * MM - DISCLAIMER.topp - 4, color: cmyk(0, 0, 0, 0.3),
    });
  }

  const T = (x: number, y: number, s: string, st: number, f: any, c: any) =>
    side.drawText(s, { x: x * MM, y: y * MM, size: st, font: f, color: c });
  const midt = (s: string, st: number, f: any) =>
    (A4.b - f.widthOfTextAtSize(s, st) / MM) / 2;

  T(MARGIN, L.tittelY, jobb, 14, fet, sort);
  for (const r of L.felter) {
    T(r.x, r.y, r.navn, 7.5, helv, damp);
    T(r.x + 32, r.y, r.verdi, 8.5, helv, sort);
  }
  T(MARGIN, L.malestokkY, L.malestokkTekst, 8, helv, damp);
  side.drawLine({
    start: { x: MARGIN * MM, y: L.regelY * MM },
    end: { x: (A4.b - MARGIN) * MM, y: L.regelY * MM },
    thickness: 0.5, color: sort,
  });

  for (const el of L.elementer) {
    const m = el.motiv;
    const s = (el.b * MM) / (m.bbox[2] - m.bbox[0]);
    const dx = el.x * MM - s * m.bbox[0];
    const dy = el.y * MM - s * m.bbox[1];
    const deler = (m.deler?.length ? [...m.deler].reverse() : [{ hex: m.hex, cmyk: m.cmyk, flate: m.flate }]);
    for (const del of deler) {
      const ops: string[] = [];
      for (const poly of del.flate) {
        for (const ring of poly) {
          if (ring.length < 3) continue;
          ops.push(`${(ring[0][0] * s + dx).toFixed(3)} ${(ring[0][1] * s + dy).toFixed(3)} m`);
          for (let i = 1; i < ring.length; i++) {
            ops.push(`${(ring[i][0] * s + dx).toFixed(3)} ${(ring[i][1] * s + dy).toFixed(3)} l`);
          }
          ops.push("h");
        }
        ops.push("f*");   // hullene skal sta apne
      }
      if (!ops.length) continue;
      const f = del.cmyk;
      side.pushOperators(raa(
        `q\n${f[0]} ${f[1]} ${f[2]} ${f[3]} k\n${ops.join("\n")}\nQ`));
    }

    T(midt(el.etikett, 8.5, helv), el.etikettY, el.etikett, 8.5, helv, sort);
    if (el.advarsel) T(midt(el.advarsel, 7.5, fet), el.advarselY, el.advarsel, 7.5, fet, rod);
  }

  if (disclaimerBilde) {
    const bilde = await doc.embedJpg(disclaimerBilde as any);
    side.drawImage(bilde, {
      x: 0, y: DISCLAIMER.bunn - 2, width: A4.b * MM,
      height: DISCLAIMER.topp - DISCLAIMER.bunn + 4,
    });
  }

  doc.setTitle(`${jobb} | skisse`);
  doc.setProducer("SignHub");
  return { bytes: await doc.save(), layout: L };
}
