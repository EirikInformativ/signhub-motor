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
import { offsetRinger } from "./ramme.ts";
import * as pcModul from "polygon-clipping";
const pc: any = (pcModul as any).default ?? pcModul;

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
  /**
   * Tett gruppe: thru-cut-linjen rundt bitene, i elementets enheter.
   * Bitene (flate) kiss-cuttes; linjen her thru-cuttes.
   */
  thruForm?: MultiPoly;
  /** flater som vises med sitt fyll og kiss-strek (det som er lagt tett) */
  markering?: { flate: MultiPoly; fyllOp: string }[];
  /**
   * Printet element: fargene som printes (nederst foerst). flate er da
   * skjaerelinjen (kiss), og den tegnes bare som strek.
   */
  trykk?: { flate: MultiPoly; fyllOp: string; spot?: { navn: string; tint: number; cmyk: number[]; lab?: { wp: number[]; c1: number[] } } }[];
}

export interface Plassering {
  x: number; y: number; w: number; h: number; rotated: boolean; id: number;
  /** snudd 180° i boksen (i tillegg til rotated): formnesting av tette grupper */
  snu?: boolean;
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

const PRINT_BLEED_MM = 2;
/** Flatene utvidet med utfallende, i elementets egne enheter. */
function utfallende(flate: MultiPoly, d: number): MultiPoly {
  return flate.map((poly) => offsetRinger([poly[0].map(([x, y]) => [x, y] as [number, number])], d, true)
    .map((r) => [...r, r[0]] as [number, number][]));
}

/**
 * Utfallende som beholder hullene: ytterkanten vokser og hullene krymper
 * med samme mål. Uten dette ble punsene i bokstavene (o, b, e) fylt helt
 * med farge paa Facebook-logoen (Eirik 16.11.2026: «helt unødvendig»).
 */
function utfallendeHull(flate: MultiPoly, d: number): MultiPoly {
  const sa = (r: [number, number][]) => { let a = 0; for (let i = 0; i < r.length; i++) { const p = r[i], q = r[(i + 1) % r.length]; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; };
  const ringer = offsetRinger(flate.flatMap((poly) => poly.map((r) => r.slice(0, -1).map(([x, y]) => [x, y] as [number, number]))), d, true);
  const lukk = (r: [number, number][]) => [[...r, r[0]]];
  const pos = ringer.filter((r) => sa(r as any) > 0).map((r) => lukk(r as any));
  const neg = ringer.filter((r) => sa(r as any) < 0).map((r) => lukk(r as any));
  if (!pos.length) return flate;
  let ut = pc.union(...(pos as [any]));
  if (neg.length) ut = pc.difference(ut, ...(neg as [any]));
  return ut as MultiPoly;
}

/**
 * Rammene kant i kant, med smaa glipper lukket (Eirik 16.11.2026: «dersom
 * gapet er mindre enn 5 mm boer du legge de sammen til 1»). To kanter som
 * vender mot hverandre med under KANT_GLIPPE_MM mellom seg, blir én linje:
 * den korteste kanten flyttes ut til den lengste, saa den lange linjen er
 * rett og den korte rammen blir litt stoerre (det horisontale elementet
 * viker, saa det vertikale ikke faar et trappetrinn midt i thru-cuten).
 */
const KANT_GLIPPE_MM = 5;
function kantRekt<T extends { x: number; y: number; w: number; h: number; id: number }>(ps: T[]): T[] {
  const r = ps.map((p) => ({ ...p }));
  for (let runde = 0; runde < 4; runde++) {
    let endret = false;
    for (const a of r) for (const b of r) {
      if (a === b) continue;
      const yOv = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      const xOv = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
      const gx = b.x - (a.x + a.w), gy = b.y - (a.y + a.h);
      if (yOv > 1e-6 && gx > 1e-6 && gx < KANT_GLIPPE_MM) {
        if (a.h <= b.h) a.w += gx; else { b.x -= gx; b.w += gx; }
        endret = true;
      } else if (xOv > 1e-6 && gy > 1e-6 && gy < KANT_GLIPPE_MM) {
        if (a.w <= b.w) a.h += gy; else { b.y -= gy; b.h += gy; }
        endret = true;
      }
    }
    if (!endret) break;
  }
  return r;
}

/** Bare strek i et fargerom (kiss eller thru), i elementets enheter. */
function strekOpsFlate(flate: MultiPoly, skala: number, cs: string, strek = 0.25): string {
  let o = `/${cs} CS\n1 SCN\n${(strek / skala).toFixed(6)} w\n`;
  for (const poly of flate) for (const r of poly) {
    if (r.length < 3) continue;
    o += `${f4(r[0][0])} ${f4(r[0][1])} m\n`;
    for (const q of r.slice(1)) o += `${f4(q[0])} ${f4(q[1])} l\n`;
    o += "h\nS\n";
  }
  return o;
}

/** Bare fyll, ingen strek: flatene i foliens farge. */
function fyllOps(flate: MultiPoly, fyllOp: string): string {
  let o = fyllOp + "\n";
  for (const poly of flate) {
    for (const r of poly) {
      if (r.length < 3) continue;
      o += `${f4(r[0][0])} ${f4(r[0][1])} m\n`;
      for (const q of r.slice(1)) o += `${f4(q[0])} ${f4(q[1])} l\n`;
      o += "h\n";
    }
    o += "f*\n";
  }
  return o;
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
  /** printet folie: regmarks, og fyllet printes 2 mm utenfor kuttet */
  print?: boolean;
  /** spotfargen fyllet skal printes i (fra skissen), ellers skjermfargen */
  spot?: { navn: string; tint: number; cmyk: number[]; lab?: { wp: number[]; c1: number[] } };
  /** rektangulaere rammer kant i kant: thru som sammenslaatte linjer, kiss-boks innenfor */
  kantIKant?: boolean;
  /** helfolieringsfolie: bare thru-cut langs stykkene, ingen applisering */
  helfoliering?: boolean;
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
  /**
   * Spotfargen printes med navnet og alternativet fra skissen. Hadde skissen
   * Lab-alternativ (Pantone-bibliotek i Illustrator), beholdes det; CMYK er
   * reserve.
   */
  const csSpot = !valg.spot ? null : valg.spot.lab
    ? doc.context.register(doc.context.obj([
        PDFName.of("Separation"), PDFName.of(valg.spot.navn),
        doc.context.obj([PDFName.of("Lab"), doc.context.obj({ WhitePoint: valg.spot.lab.wp, Range: [-128, 127, -128, 127] })]),
        doc.context.register(doc.context.obj({ FunctionType: 2, Domain: [0, 1], C0: [100, 0, 0], C1: valg.spot.lab.c1, N: 1,
          Range: [0, 100, -128, 127, -128, 127] })),
      ]))
    : separasjon(doc, valg.spot.navn, valg.spot.cmyk);
  if (valg.spot) folieFyll = `/CS2 cs\n${f4(valg.spot.tint)} scn`;
  // spotfargene i printede elementer: ett fargerom per navn (CS3, CS4, ...)
  const ekstraCs: [string, PDFRef][] = [];
  const csFor = (sp: NonNullable<ArkValg["spot"]>) => {
    const finnes = ekstraCs.findIndex(([n]) => n === sp.navn);
    if (finnes >= 0) return `CS${3 + finnes}`;
    const ref = sp.lab
      ? doc.context.register(doc.context.obj([PDFName.of("Separation"), PDFName.of(sp.navn),
          doc.context.obj([PDFName.of("Lab"), doc.context.obj({ WhitePoint: sp.lab.wp, Range: [-128, 127, -128, 127] })]),
          doc.context.register(doc.context.obj({ FunctionType: 2, Domain: [0, 1], C0: [100, 0, 0], C1: sp.lab.c1, N: 1,
            Range: [0, 100, -128, 127, -128, 127] }))]))
      : separasjon(doc, sp.navn, sp.cmyk);
    ekstraCs.push([sp.navn, ref]);
    return `CS${3 + ekstraCs.length - 1}`;
  };

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
    // Appliser+thru: bare fyll, saa det synes hvilken farge det er. Linjene
    // skjaeres fra Thru-cut-laget, slaatt sammen (Eirik 16.11.2026).
    /**
     * Printet element: fargene printes hver for seg, nederst foerst, og de
     * fargede lagene printes PRINT_BLEED_MM ut forbi skjaerelinjen (bare
     * utover, ikke inn i det hvite, som er mediet selv). Skjaerelinjen er
     * hele elementet, som kiss i CutContour, uten fyll.
     */
    if (m.trykk?.length && !valg.kunThru) {
      const bl = (PRINT_BLEED_MM * MM) / m.skala;
      let alle: MultiPoly = [];
      try { alle = pc.union(...(m.trykk.map((t) => t.flate).concat([m.flate]) as [any])); } catch { alle = m.flate; }
      let o = "";
      for (const t of m.trykk) {
        let fl: MultiPoly = t.flate;
        try { fl = pc.union(t.flate as any, pc.difference(utfallendeHull(t.flate, bl) as any, alle as any)) as MultiPoly; } catch { /* uten utfall */ }
        o += fyllOps(fl, t.spot ? `/${csFor(t.spot)} cs\n${f4(t.spot.tint)} scn` : t.fyllOp);
      }
      formOps[i] = o + strekOpsFlate(m.flate, m.skala, "CS1");
      return;
    }
    formOps[i] = valg.kunThru
      ? fyllOps(valg.print ? utfallende(m.flate, (PRINT_BLEED_MM * MM) / m.skala) : m.flate, folieFyll)
      : skjaereOps(m.flate, m.skala, folieFyll, geo.strek, "CS1").ops;
    // det som er lagt tett: fyll og kiss-strek, saa montoeren ser hvor det skal
    if (!valg.kunThru) for (const mk of m.markering ?? []) formOps[i] += skjaereOps(mk.flate, m.skala, mk.fyllOp, geo.strek, "CS1").ops;
  });
  /** Bane i elementets enheter som strek i gitt fargerom (kiss eller thru). */
  const strekOps = (flate: MultiPoly, skala: number, cs: string) => {
    let o = `/${cs} CS\n1 SCN\n${(geo.strek / skala).toFixed(6)} w\n`;
    for (const poly of flate) for (const r of poly) {
      if (r.length < 3) continue;
      o += `${f4(r[0][0])} ${f4(r[0][1])} m\n`;
      for (const q of r.slice(1)) o += `${f4(q[0])} ${f4(q[1])} l\n`;
      o += "h\nS\n";
    }
    return o;
  };
  /** Samme transform som Design-laget: elementets enheter til arket. */
  const iElement = (p: Plassering, innhold: string) => {
    const m = motiver[p.id], b = m.bbox, s = m.skala;
    const lx = (p.x + geo.bleed) * MM, lb = ytop(p.y + p.h - geo.bleed);
    const snu = p.snu ? `q\n-1 0 0 -1 ${f4(2 * (p.x + p.w / 2) * MM)} ${f4(2 * ytop(p.y + p.h / 2))} cm\n` : "";
    return snu + (p.rotated
      ? `q\n0 ${s.toFixed(6)} ${(-s).toFixed(6)} 0 ${f4(lx + s * (b[3] - b[1]) + s * b[1])} ${f4(lb - s * b[0])} cm\n${innhold}Q\n`
      : `q\n${s.toFixed(6)} 0 0 ${s.toFixed(6)} ${f4(lx - s * b[0])} ${f4(lb - s * b[1])} cm\n${innhold}Q\n`) + (p.snu ? "Q\n" : "");
  };

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
    if (p.snu) {
      // 180° om boksens midtpunkt
      const cx = (p.x + p.w / 2) * MM, cy = ytop(p.y + p.h / 2);
      ops.push(`q\n-1 0 0 -1 ${f4(2 * cx)} ${f4(2 * cy)} cm\n`);
    }
    if (p.rotated) {
      const tx = lx + s * (b[3] - b[1]);
      ops.push(`q\n0 ${s.toFixed(6)} ${(-s).toFixed(6)} 0 ` +
               `${f4(tx + s * b[1])} ${f4(lb - s * b[0])} cm\n${formOps[p.id]}Q\n`);
    } else {
      ops.push(`q\n${s.toFixed(6)} 0 0 ${s.toFixed(6)} ` +
               `${f4(lx - s * b[0])} ${f4(lb - s * b[1])} cm\n${formOps[p.id]}Q\n`);
    }
    if (p.snu) ops.push("Q\n");
  }
  ops.push("Q\nEMC\n");

  /**
   * Appliser+thru: skjaerelinjene slaatt sammen (Eirik 16.11.2026,
   * prinsippet fra klebemerkene). Elementer som ligger kant i kant deler
   * linje, og den skjaeres én gang. Flatene ligger i Design-laget med bare
   * fyll og ingen strek, saa det er tydelig hvilken farge det er.
   */
  if (valg.kunThru) {
    ops.push(`/OC /L1 BDC\nq\n/CS0 CS\n1 SCN\n${f4(geo.strek)} w\n`);
    // tette grupper har sin egen thru-linje og slaas ikke sammen med andre
    for (const bane of slaaSammenLinjer(motiver.map((m) => (m.thruForm ? { ...m, flate: [] } : m)), ark, geo)) {
      let o = `${f4(bane[0][0] * MM)} ${f4(ytop(bane[0][1]))} m\n`;
      for (const q of bane.slice(1)) o += `${f4(q[0] * MM)} ${f4(ytop(q[1]))} l\n`;
      ops.push(o + "S\n");
    }
    for (const p of ark.plasseringer) {
      const m = motiver[p.id];
      if (m.thruForm) ops.push(iElement(p, strekOps(m.thruForm, m.skala, "CS0")));
    }
    ops.push("Q\nEMC\n");
    // kiss rundt hver bit i de tette gruppene
    if (motiver.some((m) => m.thruForm)) {
      ops.push("/OC /L3 BDC\nq\n");
      for (const p of ark.plasseringer) {
        const m = motiver[p.id];
        if (m.thruForm) ops.push(iElement(p, strekOps(m.flate, m.skala, "CS1")));
      }
      ops.push("Q\nEMC\n");
    }
  }

  // Thru-cut (ved kunThru er elementenes egen strek thru-cutten)
  if (valg.thruCut && !valg.kunThru) {
    ops.push(`/OC /L1 BDC\nq\n/CS0 CS\n1 SCN\n${f4(geo.strek)} w\n`);
    /**
     * Thru-cut deler arket i ett stykke per element. Stykket ma vaere der
     * ogsa naar elementet ikke har noe i denne folien, for de andre
     * fargene legges oppa nettopp dette stykket.
     */
    if (valg.kantIKant) {
      // hver delte kant skjaeres én gang, i sammenhengende linjer
      const kanter: [Pkt, Pkt][] = [];
      for (const p of kantRekt(ark.plasseringer)) {
        const a: Pkt[] = [[p.x, p.y], [p.x + p.w, p.y], [p.x + p.w, p.y + p.h], [p.x, p.y + p.h]];
        for (let i = 0; i < 4; i++) kanter.push([a[i], a[(i + 1) % 4]]);
      }
      for (const bane of slaaSammenKanter(kanter)) {
        let o = `${f4(bane[0][0] * MM)} ${f4(ytop(bane[0][1]))} m\n`;
        for (const q of bane.slice(1)) o += `${f4(q[0] * MM)} ${f4(ytop(q[1]))} l\n`;
        ops.push(o + "S\n");
      }
    } else for (const p of ark.plasseringer) {
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
  /**
   * Kant i kant (Eirik 16.11.2026): kiss kan aldri ligge innenfor thru, for
   * da blir en stripe folie mellom dem staaende rundt logoen. Inne mellom
   * elementene skjaerer thru allerede gjennom folien, saa der trengs ingen
   * egen kiss. Ut mot sidene gaar kiss boksKiss utenfor thru, rundt hele
   * blokken. Paa ark uten thru gaar kiss paa linjen der thru er paa
   * primaerarket, én gang per linje.
   */
  if (valg.kantIKant && !valg.kunThru) {
    const rekt = kantRekt(ark.plasseringer).filter((p) => harForm[p.id])
      .map((p) => [[[p.x, p.y], [p.x + p.w, p.y], [p.x + p.w, p.y + p.h], [p.x, p.y + p.h], [p.x, p.y]]]);
    if (valg.thruCut && rekt.length) {
      const blokk = pc.union(...(rekt as [any])) as MultiPoly;
      const ytreRinger: Pkt[][] = [];
      for (const poly of blokk) for (const r of offsetRinger([poly[0].slice(0, -1) as [number, number][]], geo.boksKiss, true)) {
        ytreRinger.push([...r, r[0]] as Pkt[]);
        ops.push(ringOps([...r, r[0]], ytop));
      }
      /*
       * Kiss ogsaa mellom hver logo, eksakt i sporet til thru-cuten (Eirik
       * 17.11.2026), saa lukeren kan ta én logo om gangen. Bare de indre
       * kantene: der det ligger et element paa begge sider.
       */
      const inni = (x: number, y: number) => rekt.some((q) => { const r = q[0] as Pkt[];
        return x > r[0][0] && x < r[1][0] && y > r[0][1] && y < r[2][1]; });
      const indre: [Pkt, Pkt][] = [];
      for (const x of rekt) {
        const r = x[0] as Pkt[];
        for (let i = 0; i < 4; i++) {
          const a = r[i], b = r[i + 1];
          const L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L < 1e-6) continue;
          const nx = -(b[1] - a[1]) / L, ny = (b[0] - a[0]) / L, e = 0.3;
          // del kanten i stykker og ta med det som har element paa begge sider
          const n = Math.max(1, Math.ceil(L / 2));
          let start: Pkt | null = null;
          for (let k = 0; k <= n; k++) {
            const t = k / n, px = a[0] + (b[0] - a[0]) * t, py = a[1] + (b[1] - a[1]) * t;
            const tm = Math.min(1, (k + 0.5) / n), mx = a[0] + (b[0] - a[0]) * tm, my = a[1] + (b[1] - a[1]) * tm;
            const begge = k < n && inni(mx + nx * e, my + ny * e) && inni(mx - nx * e, my - ny * e);
            if (begge && !start) start = [px, py];
            if ((!begge || k === n) && start) { indre.push([start, [px, py]]); start = null; }
          }
        }
      }
      /*
       * Der en indre kiss naar ytterkanten av blokken, kobles den til den
       * ytre kiss-rammen med en rett strek til naermeste punkt paa rammen
       * (Eirik 17.11.2026, med tegning): i et innvendig hjoerne er det 45°
       * til rammens hjoerne, saa lukeren kan dra hele kanten i ett.
       */
      const blokkRinger = blokk.map((poly) => poly[0] as Pkt[]);
      const naermest = (ringer: Pkt[][], p: Pkt): { q: Pkt; d: number } => {
        let best = { q: p, d: Infinity };
        for (const r of ringer) for (let i = 0; i < r.length - 1; i++) {
          const a = r[i], b = r[i + 1], dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy;
          const t = L2 > 0 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2)) : 0;
          const q: Pkt = [a[0] + dx * t, a[1] + dy * t], d = Math.hypot(q[0] - p[0], q[1] - p[1]);
          if (d < best.d) best = { q, d };
        }
        return best;
      };
      for (const bane of slaaSammenKanter(indre)) {
        const ende = (p: Pkt) => naermest(blokkRinger, p).d < 0.05 ? naermest(ytreRinger, p).q : null;
        const foer = ende(bane[0]), etter = ende(bane[bane.length - 1]);
        const linje = [...(foer ? [foer] : []), ...bane, ...(etter ? [etter] : [])];
        let o = `${f4(linje[0][0] * MM)} ${f4(ytop(linje[0][1]))} m\n`;
        for (const q of linje.slice(1)) o += `${f4(q[0] * MM)} ${f4(ytop(q[1]))} l\n`;
        ops.push(o + "S\n");
      }
    } else if (rekt.length) {
      const kanter: [Pkt, Pkt][] = [];
      for (const x of rekt) { const r = x[0] as Pkt[]; for (let i = 0; i < 4; i++) kanter.push([r[i], r[i + 1]]); }
      for (const bane of slaaSammenKanter(kanter)) {
        let o = `${f4(bane[0][0] * MM)} ${f4(ytop(bane[0][1]))} m\n`;
        for (const q of bane.slice(1)) o += `${f4(q[0] * MM)} ${f4(ytop(q[1]))} l\n`;
        ops.push(o + "S\n");
      }
    }
  }
  for (const p of valg.kunThru || valg.kantIKant ? [] : ark.plasseringer) {
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
  if (csSpot) cs.set(PDFName.of("CS2"), csSpot);
  ekstraCs.forEach(([, ref], i) => cs.set(PDFName.of(`CS${3 + i}`), ref));
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

  const medKiss = motiver.some((m) => m.thruForm);
  doc.setTitle(valg.helfoliering
    ? `${jobb} | Thru | ${folieTekst} | Helfolieringsfolie: thru-cut langs stykkene, ingen applisering`
    : valg.kunThru && (valg.print || medKiss)
    ? `${jobb} | ${valg.print ? (medKiss ? "Print+kiss+thru" : "Print+thru") : "Kiss+thru"} | ${folieTekst}` +
      (valg.spot ? ` | print i ${valg.spot.navn}` : "")
    : valg.kunThru
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
    const til0 = ([X, Y]: number[]): Pkt => p.rotated
      ? [p.x + bl + (b[3] - Y) * k, p.y + p.h - bl - (X - b[0]) * k]
      : [p.x + bl + (X - b[0]) * k, p.y + p.h - bl - (Y - b[1]) * k];
    // snudd 180° innenfor plasseringen, som iElement
    const til = (q: number[]): Pkt => {
      const [x, y] = til0(q);
      return p.snu ? [2 * p.x + p.w - x, 2 * p.y + p.h - y] : [x, y];
    };
    for (const poly of m.flate) for (const r of poly) {
      for (let i = 0; i < r.length - 1; i++) {
        const a = til(r[i]), c = til(r[i + 1]);
        if (Math.hypot(c[0] - a[0], c[1] - a[1]) > 1e-6) kanter.push([a, c]);
      }
    }
  }
  return slaaSammenKanter(kanter);
}

/** Kanter paa samme linje slaas sammen; sammenhengende stykker blir én bane. */
const LINJE_VINKEL = 0.01;      // radianer
const LINJE_AVSTAND_MM = 1;
export function slaaSammenKanter(kanter: [Pkt, Pkt][]): Pkt[][] {
  /**
   * Grupper paa linje: retning og avstand fra origo. Linjer som ligger
   * nesten oppaa hverandre (samme retning innenfor LINJE_VINKEL og under
   * LINJE_AVSTAND_MM fra hverandre i begge ender) er samme linje, og kniven
   * gaar én gang, langs den lengste (Eirik 16.11.2026: to thru-linjer et par
   * millimeter fra hverandre fungerer daarlig i praksis). Lengste foerst, saa
   * den lange linjen er den som staar.
   */
  const grupper: { ux: number; uy: number; d: number; iv: [number, number][] }[] = [];
  const sortert = kanter.slice().sort((x, y) => Math.hypot(y[1][0] - y[0][0], y[1][1] - y[0][1]) - Math.hypot(x[1][0] - x[0][0], x[1][1] - x[0][1]));
  for (const [a, c] of sortert) {
    let ux = c[0] - a[0], uy = c[1] - a[1];
    const l = Math.hypot(ux, uy); ux /= l; uy /= l;
    if (ux < -1e-9 || (Math.abs(ux) < 1e-9 && uy < 0)) { ux = -ux; uy = -uy; }
    let g = grupper.find((h) => Math.abs(h.ux * uy - h.uy * ux) < LINJE_VINKEL &&
      Math.abs(-h.uy * a[0] + h.ux * a[1] - h.d) < LINJE_AVSTAND_MM && Math.abs(-h.uy * c[0] + h.ux * c[1] - h.d) < LINJE_AVSTAND_MM);
    if (!g) { g = { ux, uy, d: -uy * a[0] + ux * a[1], iv: [] }; grupper.push(g); }
    const t0 = g.ux * a[0] + g.uy * a[1], t1 = g.ux * c[0] + g.uy * c[1];
    g.iv.push([Math.min(t0, t1), Math.max(t0, t1)]);
  }
  const ut: [Pkt, Pkt][] = [];
  for (const g of grupper) {
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
