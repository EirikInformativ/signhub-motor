/**
 * Setter sammen den ferdige produksjonsfila.
 *
 * Lag:      Design, Thru-cut, Kiss-cut, Regmark
 * Thru-cut: spotfargen Through, 5 mm utenfor motivet
 * Kiss-cut: spotfargen CutContour
 *             boks 2,5 mm utenfor hver thru-cut, sa en og en logo kan strippes
 *             boks rundt hver regmark-kolonne
 *             doble regmarks i summa-varianten, som strek
 * Regmark:  sorte sirkler
 *
 * Illustrator lager ikke ekte lag av PDF-lag. Det er kontrollert pa maskin og
 * spiller ingen rolle: kutteren leser strekfargen, ikke laget.
 */
import { PDFDocument, PDFName, PDFString, PDFRef } from "pdf-lib";
import type { MultiPoly } from "./pdfbaner.ts";
import { byggSkjaereform, separasjon } from "./skjaereform.ts";

export const MM = 72 / 25.4;
const KAPPA = 0.5522847498307936;
const f4 = (n: number) => n.toFixed(4);

export interface Geo {
  /** rullens fulle bredde. Arket blir sa bredt. */
  foliebredde: number;
  /**
   * Hvor bredt maskinen faktisk kan skjaere. Skjaereomradet legges midt pa
   * rullen. Utelates den, brukes hele rullebredden.
   */
  skjaerebredde?: number;
  /** fysisk margin rullen trenger, 20 mm i hver kant */
  rullKant: number;
  /** bredeste rull wild-maskinen tar imot */
  wildMaksRull: number;
  /**
   * Bredeste wild-maskinen skjaerer. Malt pa den ytterste skjaerelinjen i
   * fila, ikke pa arkmalet.
   */
  wildMaksSkjaer: number;
  /** bredeste summa-maskinen skjaerer */
  summaMaksSkjaer: number;
  bleed: number;
  gap: number;
  regmarkD: number;
  kissInset: number;
  regClear: number;
  regmarkKiss: number;
  boksKiss: number;
  regTarget: number;
  strek: number;
}

export const STD_GEO: Geo = {
  foliebredde: 1200,
  rullKant: 40, wildMaksRull: 1260, wildMaksSkjaer: 1215, summaMaksSkjaer: 1600,
  bleed: 5, gap: 7.5, regmarkD: 5, kissInset: 5,
  regClear: 5, regmarkKiss: 2.5, boksKiss: 2.5, regTarget: 500, strek: 0.25,
};

export interface Motiv {
  navn: string;
  flate: MultiPoly;
  bbox: [number, number, number, number];
  skala: number;
  breddeMm: number;
  hoydeMm: number;
  antall: number;
}

export interface Plassering {
  x: number; y: number; w: number; h: number; rotated: boolean; id: number;
}

export interface Ark {
  plasseringer: Plassering[];
  arklengde: number;
  /** arkets faktiske bredde. Kan vaere smalere enn rullen. */
  breddeMm: number;
  regY: number[];
  xVenstre: number;
  xHoyre: number;
  regBokser: [number, number, number, number][];
}

function sirkel(cx: number, cy: number, r: number, op: "f" | "S"): string {
  const k = KAPPA * r;
  const c = (a: number, b: number, cc: number, d: number, e: number, g: number) =>
    `${f4(a)} ${f4(b)} ${f4(cc)} ${f4(d)} ${f4(e)} ${f4(g)} c\n`;
  return (
    `${f4(cx + r)} ${f4(cy)} m\n` +
    c(cx + r, cy + k, cx + k, cy + r, cx, cy + r) +
    c(cx - k, cy + r, cx - r, cy + k, cx - r, cy) +
    c(cx - r, cy - k, cx - k, cy - r, cx, cy - r) +
    c(cx + k, cy - r, cx + r, cy - k, cx + r, cy) +
    `h\n${op}\n`
  );
}

export interface ArkValg {
  /**
   * Thru-cut skjaerer gjennom baeren og deler arket. Den hoerer bare hjemme
   * pa primaerfargen. Sekundaerfargene legges oppa, og skal ligge hele.
   */
  thruCut: boolean;
  /** regmarks bare pa primaerfargen. Sekundaerfargene skjaeres wild. */
  regmark: boolean;
  /** doble regmarks i CutContour, til summa-varianten */
  dobleRegmarks: boolean;
  /**
   * Ytre ramme rundt hele arket, 5 mm inn fra skjaerekanten.
   * Bare naar jobben har flere farger som skal legges oppa hverandre:
   * da rives kanten av sa lagene kan legges i register. En ettfarget jobb
   * trenger den ikke.
   */
  ytreRamme: boolean;
}

export async function byggProduksjonsfil(
  motiver: Motiv[], ark: Ark, geo: Geo,
  folieFyll: string, variant: string, valg: ArkValg,
  jobb: string, folieTekst: string
): Promise<Uint8Array> {
  const dobleRegmarks = valg.dobleRegmarks;
  const doc = await PDFDocument.create();
  const csThrough = separasjon(doc, "Through", [1, 0, 0, 0]);
  const csCut = separasjon(doc, "CutContour", [0, 1, 0, 0]);

  const ocg = (navn: string): PDFRef =>
    doc.context.register(doc.context.obj({
      Type: PDFName.of("OCG"), Name: PDFString.of(navn),
      Usage: doc.context.obj({
        Print: doc.context.obj({ PrintState: PDFName.of("ON") }),
        View: doc.context.obj({ ViewState: PDFName.of("ON") }),
      }),
    }));
  const oc = [ocg("Design"), ocg("Thru-cut"), ocg("Kiss-cut"), ocg("Regmark")];

  const xobj = doc.context.obj({});
  const harForm: boolean[] = [];
  motiver.forEach((m, i) => {
    harForm[i] = m.flate.length > 0;
    if (!harForm[i]) return;   // elementet finnes ikke i denne folien
    const sf = byggSkjaereform(doc, m.flate, m.bbox, m.skala, folieFyll, geo.strek);
    xobj.set(PDFName.of(`Fm${i}`), sf.ref);
  });

  const W = ark.breddeMm * MM;
  const H = ark.arklengde * MM;
  const ytop = (v: number) => H - v * MM;
  const ops: string[] = [];

  // Design
  ops.push("/OC /L0 BDC\nq\n");
  for (const p of ark.plasseringer) {
    if (!harForm[p.id]) continue;
    const m = motiver[p.id];
    const b = m.bbox, s = m.skala;
    const lx = (p.x + geo.bleed) * MM;
    const lb = ytop(p.y + p.h - geo.bleed);
    if (p.rotated) {
      const tx = lx + s * (b[3] - b[1]);
      ops.push(`q\n0 ${s.toFixed(6)} ${(-s).toFixed(6)} 0 ` +
               `${f4(tx + s * b[1])} ${f4(lb - s * b[0])} cm\n/Fm${p.id} Do\nQ\n`);
    } else {
      ops.push(`q\n${s.toFixed(6)} 0 0 ${s.toFixed(6)} ` +
               `${f4(lx - s * b[0])} ${f4(lb - s * b[1])} cm\n/Fm${p.id} Do\nQ\n`);
    }
  }
  ops.push("Q\nEMC\n");

  // Thru-cut
  if (valg.thruCut) {
    ops.push(`/OC /L1 BDC\nq\n/CS0 CS\n1 SCN\n${f4(geo.strek)} w\n`);
    /**
     * Thru-cut deler arket i ett stykke per element. Stykket ma vaere der
     * ogsa naar elementet ikke har noe i denne folien, for de andre
     * fargene legges oppa nettopp dette stykket.
     */
    for (const p of ark.plasseringer) {
      ops.push(`${f4(p.x * MM)} ${f4(ytop(p.y + p.h))} ${f4(p.w * MM)} ${f4(p.h * MM)} re\nS\n`);
    }
    ops.push("Q\nEMC\n");
  }

  // Kiss-cut
  ops.push(`/OC /L3 BDC\nq\n/CS1 CS\n1 SCN\n${f4(geo.strek)} w\n`);

  // ytre ramme, sa hele kanten kan rives av i ett stykke.
  // Den ligger utenfor regmark-kolonnene, ikke mellom dem og logoene.
  if (valg.ytreRamme) {
    ops.push(`${f4(geo.kissInset * MM)} ${f4(ytop(ark.arklengde - geo.kissInset))} ` +
             `${f4((ark.breddeMm - 2 * geo.kissInset) * MM)} ` +
             `${f4((ark.arklengde - 2 * geo.kissInset) * MM)} re\nS\n`);
  }

  if (valg.regmark) {
    for (const [bx, by, bw, bh] of ark.regBokser) {
      ops.push(`${f4(bx * MM)} ${f4(ytop(by + bh))} ${f4(bw * MM)} ${f4(bh * MM)} re\nS\n`);
    }
  }
  /**
   * Ruta rundt hvert element er et hjelpekutt, sa lukeren kan ta en logo
   * om gangen i stedet for a skjaere mellom dem for hand. Har elementet
   * ingenting i denne folien, er det ingenting a luke, og da skal ruta
   * ikke vaere der. Plassen blir staaende, for alle foliene ma ha samme
   * oppsett for a ligge i register.
   */
  for (const p of ark.plasseringer) {
    if (!harForm[p.id]) continue;
    const k = geo.boksKiss;
    ops.push(`${f4((p.x - k) * MM)} ${f4(ytop(p.y + p.h + k))} ` +
             `${f4((p.w + 2 * k) * MM)} ${f4((p.h + 2 * k) * MM)} re\nS\n`);
  }
  ops.push("Q\nEMC\n");

  // Regmark
  const rr = (geo.regmarkD / 2) * MM;
  if (valg.regmark) {
    ops.push("/OC /L2 BDC\nq\n0 0 0 1 k\n");
    for (const y of ark.regY) {
      for (const x of [ark.xVenstre, ark.xHoyre]) ops.push(sirkel(x * MM, ytop(y), rr, "f"));
    }
    ops.push("Q\nEMC\n");
  }

  if (valg.regmark && dobleRegmarks) {
    ops.push(`/OC /L3 BDC\nq\n/CS1 CS\n1 SCN\n${f4(geo.strek)} w\n`);
    for (const y of ark.regY) {
      for (const x of [ark.xVenstre, ark.xHoyre]) ops.push(sirkel(x * MM, ytop(y), rr, "S"));
    }
    ops.push("Q\nEMC\n");
  }

  const page = doc.addPage([W, H]);
  const contentRef = doc.context.register(doc.context.flateStream(ops.join("")));
  page.node.set(PDFName.of("Contents"), contentRef);

  const res = (page.node as any).Resources() ?? doc.context.obj({});
  page.node.set(PDFName.of("Resources"), res);
  res.set(PDFName.of("XObject"), xobj);
  const cs = doc.context.obj({});
  cs.set(PDFName.of("CS0"), csThrough);
  cs.set(PDFName.of("CS1"), csCut);
  res.set(PDFName.of("ColorSpace"), cs);
  const props = doc.context.obj({});
  props.set(PDFName.of("L0"), oc[0]);
  props.set(PDFName.of("L1"), oc[1]);
  props.set(PDFName.of("L2"), oc[3]);
  props.set(PDFName.of("L3"), oc[2]);
  res.set(PDFName.of("Properties"), props);
  page.node.set(PDFName.of("TrimBox"), doc.context.obj([0, 0, W, H]));
  page.node.set(PDFName.of("ArtBox"), doc.context.obj([0, 0, W, H]));

  doc.catalog.set(PDFName.of("OCProperties"), doc.context.obj({
    OCGs: oc,
    D: doc.context.obj({ Order: oc, ON: oc, OFF: [], BaseState: PDFName.of("ON") }),
  }));

  doc.setTitle(`${jobb} | ${variant} | ${folieTekst}`);
  doc.setSubject(`Folie ${folieTekst}. Ark ${ark.breddeMm.toFixed(0)} x ` +
                 `${ark.arklengde.toFixed(1)} mm. ${ark.plasseringer.length} elementer.`);
  doc.setProducer("SignHub");
  return doc.save();
}
