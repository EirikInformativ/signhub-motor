/**
 * Kundeversjonen av skissen.
 *
 * Tegnes rett pa lerret og brennes til jpeg, sa det ikke finnes kurver eller
 * tekst a hente ut. Vannmerket er Informativ-logoen, gjennomsiktig oppa
 * motivet, brent inn i pikslene. Det holder seg klar av toppfeltet og av
 * disclaimeren, som forblir ren.
 *
 * Ingen pdf.js. Bare lerret og pdf-lib, sa den kjorer i nettleseren uten
 * arbeidertrad eller ekstra fontdata.
 */
import { PDFDocument } from "pdf-lib";
import { A4, DISCLAIMER, MARGIN, MM, beregnLayout } from "./skisselayout.ts";
import type { Felt, Layout, SkisseMotiv } from "./skisselayout.ts";

/**
 * Fargene er hentet fra hvordan de tilsvarende CMYK-verdiene faktisk rendres,
 * sa lerretsversjonen og vektorversjonen ser like ut.
 *   K 30 -> gra bunn, K 55 -> dempet ledetekst, K 100 -> sort, 0/100/100/0 -> rod
 */
const GRAA = "#bcbcbc";
const DAMP = "#868484";
const SORT = "#232022";
const ROD = "#ed1c24";

export type Lerret = any;
export type LerretFabrikk = (b: number, h: number) => Lerret;
/** HTMLImageElement i nettleseren, Image fra @napi-rs/canvas i node */
export type Bilde = any;

const nettleserLerret: LerretFabrikk = (b, h) => {
  const c = (globalThis as any).document.createElement("canvas");
  c.width = Math.round(b);
  c.height = Math.round(h);
  return c;
};

export interface KundeValg {
  dpi?: number;        // 100 er standard for kundeskisser
  styrke?: number;     // gjennomsiktighet pa vannmerket
  vinkel?: number;     // grader
  kolonner?: number;   // hvor mange logobredder det er plass til pa bredden
  kvalitet?: number;   // jpeg
  skrift?: string;     // fontfamilie pa lerretet
  /**
   * Bilde som skal ligge foran elementskissen, f.eks. bilskissen.
   * Legges inn som forste side, sentrert paa A4, i sin egen storrelse.
   */
  forside?: { jpeg: Uint8Array; bredde: number; hoyde: number };
}

export interface KundeSkisse {
  pdf: Uint8Array;
  jpeg: Uint8Array;
  bredde: number;
  hoyde: number;
  layout: Layout;
}

export async function byggKundeskisse(
  motiver: SkisseMotiv[], jobb: string, felt: Felt, graaBunn: boolean,
  bilder: { disclaimer: Bilde; vannmerke: Bilde },
  valg: KundeValg = {},
  lag: LerretFabrikk = nettleserLerret
): Promise<KundeSkisse> {
  const dpi = valg.dpi ?? 100;
  const styrke = valg.styrke ?? 0.065;
  const vinkel = valg.vinkel ?? 30;
  const kolonner = valg.kolonner ?? 2.4;
  const kvalitet = valg.kvalitet ?? 0.82;
  const skrift = valg.skrift ?? "Helvetica, Arial, sans-serif";

  const L = beregnLayout(motiver, felt);
  const px = dpi / 25.4;                    // mm til piksler
  const pt = dpi / 72;                      // punkt til piksler
  const W = Math.round(A4.b * px);
  const H = Math.round(A4.h * px);
  const X = (mm: number) => mm * px;
  const Y = (mm: number) => (A4.h - mm) * px;

  const c = lag(W, H);
  const g = c.getContext("2d");
  g.fillStyle = "#ffffff";
  g.fillRect(0, 0, W, H);

  // lyse folier vises pa gratt, ellers ville motivene forsvinne
  if (graaBunn) {
    g.fillStyle = GRAA;
    g.fillRect(0, 0, W, Y((DISCLAIMER.topp + 4) / MM));
  }

  const sett = (stPt: number, fet: boolean) => {
    g.font = `${fet ? "bold " : ""}${(stPt * pt).toFixed(2)}px ${skrift}`;
  };
  const T = (xmm: number, ymm: number, s: string, stPt: number, fet: boolean, farge: string) => {
    sett(stPt, fet);
    g.fillStyle = farge;
    g.textBaseline = "alphabetic";
    g.fillText(s, X(xmm), Y(ymm));
  };
  const midt = (s: string, stPt: number, fet: boolean) => {
    sett(stPt, fet);
    return (W - g.measureText(s).width) / 2 / px;
  };

  T(MARGIN, L.tittelY, jobb, 14, true, SORT);
  for (const r of L.felter) {
    T(r.x, r.y, r.navn, 7.5, false, DAMP);
    T(r.x + 32, r.y, r.verdi, 8.5, false, SORT);
  }
  T(MARGIN, L.malestokkY, L.malestokkTekst, 8, false, DAMP);

  g.strokeStyle = SORT;
  g.lineWidth = Math.max(1, 0.5 * pt);
  g.beginPath();
  g.moveTo(X(MARGIN), Y(L.regelY));
  g.lineTo(X(A4.b - MARGIN), Y(L.regelY));
  g.stroke();

  for (const el of L.elementer) {
    const m = el.motiv;
    const s = (el.b * px) / (m.bbox[2] - m.bbox[0]);   // kildepunkt til piksel
    const dx = X(el.x) - s * m.bbox[0];
    const dy = Y(el.y) + s * m.bbox[1];                // y snus
    const deler = (m.deler?.length ? [...m.deler].reverse() : [{ hex: m.hex, flate: m.flate }]);
    for (const del of deler) {
      g.fillStyle = del.hex;
      g.beginPath();
      for (const poly of del.flate) {
        for (const ring of poly) {
          if (ring.length < 3) continue;
          g.moveTo(ring[0][0] * s + dx, dy - ring[0][1] * s);
          for (let i = 1; i < ring.length; i++) {
            g.lineTo(ring[i][0] * s + dx, dy - ring[i][1] * s);
          }
          g.closePath();
        }
      }
      g.fill("evenodd");                                // hullene skal sta apne
    }

    T(midt(el.etikett, 8.5, false), el.etikettY, el.etikett, 8.5, false, SORT);
    if (el.advarsel) {
      T(midt(el.advarsel, 7.5, true), el.advarselY, el.advarsel, 7.5, true, ROD);
    }
  }

  // vannmerket, gjennomsiktig og bare i sitt eget band
  const vm = bilder.vannmerke;
  const lb = Math.max(1, Math.round(W / kolonner));
  const lh = Math.max(1, Math.round((lb * vm.height) / vm.width));
  const stegX = Math.max(1, Math.round(lb * 1.3));
  const stegY = Math.max(1, Math.round(lh * 3.4));
  const D = Math.round(Math.hypot(W, H)) + 2 * lb;
  const yTopp = Y(L.vannmerkeTopp);
  const yBunn = Y(L.vannmerkeBunn);

  g.save();
  g.beginPath();
  g.rect(0, yTopp, W, Math.max(0, yBunn - yTopp));
  g.clip();
  g.globalAlpha = styrke;
  g.translate(W / 2, H / 2);
  g.rotate((-vinkel * Math.PI) / 180);
  g.translate(-D / 2, -D / 2);
  let rad = 0;
  for (let y = 0; y < D; y += stegY) {
    for (let x = -lb + ((rad % 2) * stegX) / 2; x < D; x += stegX) {
      g.drawImage(vm, x, y, lb, lh);
    }
    rad++;
  }
  g.restore();

  // disclaimeren legges pa til slutt, ren og uten vannmerke
  const dis = bilder.disclaimer;
  const dh = ((DISCLAIMER.topp + 2 - (DISCLAIMER.bunn - 2)) / 72) * dpi;
  g.drawImage(dis, 0, H - ((DISCLAIMER.topp + 2) / 72) * dpi, W, dh);

  const jpeg = await tilJpeg(c, kvalitet);

  const doc = await PDFDocument.create();
  if (valg.forside) {
    const f = doc.addPage([A4.b * MM, A4.h * MM]);
    const bi = await doc.embedJpg(valg.forside.jpeg);
    const s = Math.min((A4.b * MM) / valg.forside.bredde, (A4.h * MM) / valg.forside.hoyde);
    const b = valg.forside.bredde * s, h = valg.forside.hoyde * s;
    f.drawImage(bi, { x: (A4.b * MM - b) / 2, y: (A4.h * MM - h) / 2, width: b, height: h });
  }
  const side = doc.addPage([A4.b * MM, A4.h * MM]);
  const bilde = await doc.embedJpg(jpeg);
  side.drawImage(bilde, { x: 0, y: 0, width: A4.b * MM, height: A4.h * MM });
  doc.setTitle(`${jobb} | skisse`);
  doc.setProducer("SignHub");
  doc.setCreator("Informativ Skilt & Dekor AS");
  doc.setSubject("Opphavsrettslig beskyttet skisse. Ma ikke videreformidles.");

  return { pdf: await doc.save(), jpeg, bredde: W, hoyde: H, layout: L };
}

async function tilJpeg(lerret: Lerret, kvalitet: number): Promise<Uint8Array> {
  if (typeof lerret.toBuffer === "function") {                 // node
    return new Uint8Array(lerret.toBuffer("image/jpeg", Math.round(kvalitet * 100)));
  }
  const blob: Blob = await new Promise((ok) =>                 // nettleser
    lerret.toBlob((b: Blob) => ok(b), "image/jpeg", kvalitet));
  return new Uint8Array(await blob.arrayBuffer());
}
