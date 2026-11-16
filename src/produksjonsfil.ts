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
import { skjaereOps, separasjon } from "./skjaereform.ts";

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
  /**
   * Elementets omriss (alle fargene samlet), i samme enheter som bbox.
   * Naar det finnes, kan rammen foelge formen (se ramme.ts).
   */
  omriss?: MultiPoly;
  /**
   * Hvilke sider som er helt rette langs elementets ramme, i elementets egen
   * retning: [venstre, hoeyre, bunn, topp]. To rette sider kan ligge kant i
   * kant uten mellomrom, og skjaerelinjen deres blir én (Appliser+thru).
   */
  sider?: [boolean, boolean, boolean, boolean];
}

export interface Plassering {
  x: number; y: number; w: number; h: number; rotated: boolean; id: number;
  /**
   * Thru-cut-rammen naar den foelger formen, i mm paa arket med y nedover.
   * Uten den er rammen rektangelet x, y, w, h.
   */
  ramme?: [number, number][];
  /** kiss-cut-boksen rundt rammen, likeledes */
  kiss?: [number, number][];
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

/** En lukket ring i mm (y nedover) som strek. */
function ringOps(r: [number, number][], ytop: (v: number) => number): string {
  let o = `${f4(r[0][0] * MM)} ${f4(ytop(r[0][1]))} m\n`;
  for (let i = 1; i < r.length; i++) o += `${f4(r[i][0] * MM)} ${f4(ytop(r[i][1]))} l\n`;
  return o + "h\nS\n";
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
  /**
   * Bare thru-cut: elementet er selve stykket. Banen fylles med
   * skjermfargen og strekes i Through, og det er den eneste linjen.
   * Ingen ramme, ingen kiss, ingen regmarks.
   */
  kunThru?: boolean;
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

  /**
   * Motivet tegnes rett inn pa siden, ikke som Form XObject. En Form
   * XObject har en BBox som Composer tolker som klippebane og skjaerer som
   * en ekstra rute pa logoens storrelse (funnet 16.11.2026, test/skjultkutt.ts).
   */
  const harForm: boolean[] = [];
  const formOps: string[] = [];
  motiver.forEach((m, i) => {
    harForm[i] = m.flate.length > 0;
    if (!harForm[i]) return;   // elementet finnes ikke i denne folien
    formOps[i] = skjaereOps(m.flate, m.skala, folieFyll, geo.strek, valg.kunThru ? "CS0" : "CS1").ops;
  });

  const W = ark.breddeMm * MM;
  const H = ark.arklengde * MM;
  const ytop = (v: number) => H - v * MM;
  const ops: string[] = [];

  /**
   * Appliser+thru: bare skjaerelinjer, slaatt sammen (Eirik 16.11.2026,
   * prinsippet fra klebemerkene). Elementer som ligger kant i kant deler
   * linje, og den skjaeres én gang. Ingen fylte baner, for wild skjaerer
   * hver bane i fila, ogsaa en fylt kopi under linjene.
   */
  if (valg.kunThru) {
    ops.push(`/OC /L1 BDC\nq\n/CS0 CS\n1 SCN\n${f4(geo.strek)} w\n`);
    for (const bane of slaaSammenLinjer(motiver, ark, geo)) {
      let o = `${f4(bane[0][0] * MM)} ${f4(ytop(bane[0][1]))} m\n`;
      for (const q of bane.slice(1)) o += `${f4(q[0] * MM)} ${f4(ytop(q[1]))} l\n`;
      ops.push(o + "S\n");
    }
    ops.push("Q\nEMC\n");
  }

  // Design
  ops.push("/OC /L0 BDC\nq\n");
  for (const p of valg.kunThru ? [] : ark.plasseringer) {
    if (!harForm[p.id]) continue;
    const m = motiver[p.id];
    const b = m.bbox, s = m.skala;
    const lx = (p.x + geo.bleed) * MM;
    const lb = ytop(p.y + p.h - geo.bleed);
    if (p.rotated) {
      const tx = lx + s * (b[3] - b[1]);
      ops.push(`q\n0 ${s.toFixed(6)} ${(-s).toFixed(6)} 0 ` +
               `${f4(tx + s * b[1])} ${f4(lb - s * b[0])} cm\n${formOps[p.id]}Q\n`);
    } else {
      ops.push(`q\n${s.toFixed(6)} 0 0 ${s.toFixed(6)} ` +
               `${f4(lx - s * b[0])} ${f4(lb - s * b[1])} cm\n${formOps[p.id]}Q\n`);
    }
  }
  ops.push("Q\nEMC\n");

  // Thru-cut (ved kunThru er elementenes egen strek thru-cutten)
  if (valg.thruCut && !valg.kunThru) {
    ops.push(`/OC /L1 BDC\nq\n/CS0 CS\n1 SCN\n${f4(geo.strek)} w\n`);
    /**
     * Thru-cut deler arket i ett stykke per element. Stykket ma vaere der
     * ogsa naar elementet ikke har noe i denne folien, for de andre
     * fargene legges oppa nettopp dette stykket.
     */
    for (const p of ark.plasseringer) {
      if (p.ramme) ops.push(ringOps(p.ramme, ytop));
      else ops.push(`${f4(p.x * MM)} ${f4(ytop(p.y + p.h))} ${f4(p.w * MM)} ${f4(p.h * MM)} re\nS\n`);
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
  // kiss-boksen (uten fyll) rundt hvert element staar ogsaa paa ark med
  // thru-cut (Eirik 16.11.2026). Bare rene thru-ark (kunThru) har ingen.
  for (const p of valg.kunThru ? [] : ark.plasseringer) {
    if (!harForm[p.id]) continue;
    const k = geo.boksKiss;
    if (p.kiss) { ops.push(ringOps(p.kiss, ytop)); continue; }
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

  doc.setTitle(valg.kunThru
    ? `${jobb} | Appliser+thru | ${folieTekst} | Appliser folie paa ${ark.breddeMm.toFixed(0)} x ${ark.arklengde.toFixed(0)} mm, legg arket i nullpunktet og thru-cut`
    : `${jobb} | ${variant} | ${folieTekst}`);
  doc.setSubject(`Folie ${folieTekst}. Ark ${ark.breddeMm.toFixed(0)} x ` +
                 `${ark.arklengde.toFixed(1)} mm. ${ark.plasseringer.length} elementer.`);
  doc.setProducer("SignHub");
  return doc.save();
}


type Pkt = [number, number];
/**
 * Alle kantene til elementene, i mm paa arket (y nedover), som rette
 * stykker. Kanter som ligger paa samme linje og overlapper, slaas sammen til
 * ett stykke, saa kniven aldri gaar i samme spor to ganger.
 */
export function slaaSammenLinjer(motiver: Motiv[], ark: Ark, geo: Geo): Pkt[][] {
  const kanter: [Pkt, Pkt][] = [];
  for (const p of ark.plasseringer) {
    const m = motiver[p.id];
    const b = m.bbox, k = m.skala / MM, bl = geo.bleed;
    const til = ([X, Y]: number[]): Pkt => p.rotated
      ? [p.x + bl + (b[3] - Y) * k, p.y + p.h - bl - (X - b[0]) * k]
      : [p.x + bl + (X - b[0]) * k, p.y + p.h - bl - (Y - b[1]) * k];
    for (const poly of m.flate) for (const r of poly) {
      for (let i = 0; i < r.length - 1; i++) {
        const a = til(r[i]), c = til(r[i + 1]);
        if (Math.hypot(c[0] - a[0], c[1] - a[1]) > 1e-6) kanter.push([a, c]);
      }
    }
  }
  // grupper paa linje: retning (vinkel mod 180) og avstand fra origo
  const grupper = new Map<string, { ux: number; uy: number; d: number; iv: [number, number][] }>();
  for (const [a, c] of kanter) {
    let ux = c[0] - a[0], uy = c[1] - a[1];
    const l = Math.hypot(ux, uy); ux /= l; uy /= l;
    if (ux < -1e-9 || (Math.abs(ux) < 1e-9 && uy < 0)) { ux = -ux; uy = -uy; }
    const d = -uy * a[0] + ux * a[1];
    const nokkel = `${Math.round(Math.atan2(uy, ux) * 1e4)}|${Math.round(d * 100)}`;
    const g = grupper.get(nokkel) ?? { ux, uy, d, iv: [] };
    const t0 = ux * a[0] + uy * a[1], t1 = ux * c[0] + uy * c[1];
    g.iv.push([Math.min(t0, t1), Math.max(t0, t1)]);
    grupper.set(nokkel, g);
  }
  const ut: [Pkt, Pkt][] = [];
  for (const g of grupper.values()) {
    g.iv.sort((x, y) => x[0] - y[0]);
    const slaatt: [number, number][] = [];
    for (const [t0, t1] of g.iv) {
      const sist = slaatt[slaatt.length - 1];
      if (sist && t0 <= sist[1] + 1e-3) sist[1] = Math.max(sist[1], t1);
      else slaatt.push([t0, t1]);
    }
    const punkt = (t: number): Pkt => [g.ux * t - g.uy * g.d, g.uy * t + g.ux * g.d];
    for (const [t0, t1] of slaatt) ut.push([punkt(t0), punkt(t1)]);
  }
  /**
   * Stykkene settes sammen til sammenhengende baner der de moetes, saa
   * kniven ikke loefter mellom hver bit av en bue. Banene tas i
   * naermeste-nabo-rekkefoelge fra nullpunktet, saa kutteren ikke kjoerer
   * tomt fram og tilbake.
   */
  const n = (p: Pkt) => `${Math.round(p[0] * 100)}|${Math.round(p[1] * 100)}`;
  const ved = new Map<string, number[]>();
  ut.forEach(([a, c], i) => { for (const q of [a, c]) (ved.get(n(q)) ?? ved.set(n(q), []).get(n(q))!).push(i); });
  const brukt = new Array(ut.length).fill(false);
  const baner: Pkt[][] = [];
  let her: Pkt = [0, 0];
  for (;;) {
    // naermeste ubrukte stykke
    let best = -1, bestD = Infinity, snu = false;
    ut.forEach(([a, c], i) => {
      if (brukt[i]) return;
      const da = Math.hypot(a[0] - her[0], a[1] - her[1]), dc = Math.hypot(c[0] - her[0], c[1] - her[1]);
      if (da < bestD) { bestD = da; best = i; snu = false; }
      if (dc < bestD) { bestD = dc; best = i; snu = true; }
    });
    if (best < 0) break;
    brukt[best] = true;
    const bane: Pkt[] = snu ? [ut[best][1], ut[best][0]] : [ut[best][0], ut[best][1]];
    for (;;) {
      const ende = bane[bane.length - 1];
      const neste = (ved.get(n(ende)) ?? []).find((i) => !brukt[i]);
      if (neste === undefined) break;
      brukt[neste] = true;
      const [a, c] = ut[neste];
      bane.push(n(a) === n(ende) ? c : a);
    }
    baner.push(bane);
    her = bane[bane.length - 1];
  }
  return baner;
}
