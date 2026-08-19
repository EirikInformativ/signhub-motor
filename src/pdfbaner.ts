/**
 * Henter ut banene i en PDF som geometri. Port av pdfbaner.py.
 *
 *   1. tolker innholdsstrommen og folger Form XObjects nedover
 *   2. flater kurver med toleranse malt i sluttstorrelse
 *   3. bygger flatene i malerens rekkefolge: en hvit bane fjerner folie,
 *      en farget bane legger folie tilbake
 *
 * Levende tekst males med Tj og gir ingen baner. Slike filer ma kjores
 * gjennom Convert to Outlines i Illustrator forst. Funksjonen sier fra.
 */
import { PDFDocument, PDFName, PDFDict, PDFArray, PDFRawStream, decodePDFRawStream } from "pdf-lib";
import * as clipperModul from "clipper-lib";
import * as pcModul from "polygon-clipping";
const ClipperLib: any = (clipperModul as any).default ?? clipperModul;
// polygon-clipping er CommonJS. Ta hoyde for begge mater den kan komme inn pa.
const pc: any = (pcModul as any).default ?? pcModul;

export type Ring = [number, number][];
export type Poly = Ring[];
export type MultiPoly = Poly[];
type Mat = [number, number, number, number, number, number];

const ID: Mat = [1, 0, 0, 1, 0, 0];
const MALE_FYLL = new Set(["f", "F", "f*", "b", "b*", "B", "B*"]);
const MALE_STREK = new Set(["S", "s", "b", "b*", "B", "B*"]);
const MALE_ANNET = new Set(["n"]);
const SKAL_LUKKES = new Set(["s", "b", "b*"]);

/**
 * Gjor en strek om til en flate.
 *
 * En strek er ikke folie for den har fatt bredde. Illustrator lagrer ofte
 * konturer som strek pa en fylt bane, og da finnes ikke konturen som form.
 * Her blaises banen ut til halve strekbredden pa hver side, slik Illustrator
 * gjor med Expand Appearance.
 */
function strekTilRinger(
  ringer: Ring[], lukket: boolean[], bredde: number,
  cap: number, join: number, miter: number
): Ring[] {
  if (!(bredde > 0)) return [];
  const S = 1e4;
  const co = new ClipperLib.ClipperOffset(miter > 0 ? miter : 2, 0.25);
  let lagtInn = 0;
  ringer.forEach((r, i) => {
    if (r.length < 2) return;
    const jt = join === 1 ? ClipperLib.JoinType.jtRound
             : join === 2 ? ClipperLib.JoinType.jtSquare
             : ClipperLib.JoinType.jtMiter;
    const et = lukket[i] ? ClipperLib.EndType.etClosedLine
             : cap === 1 ? ClipperLib.EndType.etOpenRound
             : cap === 2 ? ClipperLib.EndType.etOpenSquare
             : ClipperLib.EndType.etOpenButt;
    co.AddPath(r.map(([x, y]) => ({ X: Math.round(x * S), Y: Math.round(y * S) })), jt, et);
    lagtInn++;
  });
  if (!lagtInn) return [];
  const res: any[] = [];
  co.Execute(res, (bredde / 2) * S);
  return res.map((p: any[]) => p.map((q) => [q.X / S, q.Y / S] as [number, number]))
            .filter((r: Ring) => r.length > 2);
}

function mul(a: Mat, b: Mat): Mat {
  return [
    a[0] * b[0] + a[1] * b[2], a[0] * b[1] + a[1] * b[3],
    a[2] * b[0] + a[3] * b[2], a[2] * b[1] + a[3] * b[3],
    a[4] * b[0] + a[5] * b[2] + b[4], a[4] * b[1] + a[5] * b[3] + b[5],
  ];
}
const app = (m: Mat, x: number, y: number): [number, number] =>
  [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

function streamText(obj: any): string {
  try {
    if (obj instanceof PDFRawStream) {
      return new TextDecoder("latin1").decode(decodePDFRawStream(obj).decode());
    }
    if (obj?.getContents) return new TextDecoder("latin1").decode(obj.getContents());
  } catch { /* uleselig strom */ }
  return "";
}

/** Rekursiv utflating. Toleransen er sag i samme enhet som punktene. */
function flat(p0: [number, number], p1: [number, number], p2: [number, number],
              p3: [number, number], tol: number, ut: Ring, dybde = 0) {
  const dx = p3[0] - p0[0], dy = p3[1] - p0[1];
  const d1 = Math.abs((p1[0] - p3[0]) * dy - (p1[1] - p3[1]) * dx);
  const d2 = Math.abs((p2[0] - p3[0]) * dy - (p2[1] - p3[1]) * dx);
  if (dybde > 18 || (d1 + d2) ** 2 <= tol * (dx * dx + dy * dy)) {
    ut.push(p3);
    return;
  }
  const m = (a: [number, number], b: [number, number]): [number, number] =>
    [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const p01 = m(p0, p1), p12 = m(p1, p2), p23 = m(p2, p3);
  const p012 = m(p01, p12), p123 = m(p12, p23);
  const mid = m(p012, p123);
  flat(p0, p01, p012, mid, tol, ut, dybde + 1);
  flat(mid, p123, p23, p3, tol, ut, dybde + 1);
}

type CsKind = "gray" | "rgb" | "cmyk" | "sep" | null;

function csType(res: PDFDict | undefined, navn: string): CsKind {
  if (navn === "DeviceCMYK") return "cmyk";
  if (navn === "DeviceRGB") return "rgb";
  if (navn === "DeviceGray") return "gray";
  const csres = res?.lookup(PDFName.of("ColorSpace"), PDFDict);
  const obj: any = csres?.lookup(PDFName.of(navn));
  if (!obj) return null;
  try {
    if (obj instanceof PDFName) return csType(undefined, String(obj).slice(1));
    const fam = String(obj.lookup(0)).slice(1);
    if (fam === "ICCBased") {
      const n = obj.lookup(1)?.dict?.lookup(PDFName.of("N"))?.asNumber?.() ?? 3;
      return n === 1 ? "gray" : n === 4 ? "cmyk" : "rgb";
    }
    if (fam === "Separation" || fam === "DeviceN") return "sep";
    if (fam === "CalRGB" || fam === "Lab") return "rgb";
    if (fam === "CalGray") return "gray";
  } catch { /* ukjent fargerom */ }
  return null;
}

/** Fargen som rgb 0..1, sa fargeseparering vet hva som er hva. */
function rgbScn(kind: CsKind, tall: number[]): [number, number, number] | null {
  if (!kind || !tall.length) return null;
  const n = { gray: 1, rgb: 3, cmyk: 4, sep: 1 }[kind];
  const v = tall.slice(-n);
  if (kind === "rgb" && v.length >= 3) return [v[0], v[1], v[2]];
  if (kind === "gray" && v.length >= 1) return [v[0], v[0], v[0]];
  if (kind === "cmyk" && v.length >= 4) return cmykTilRgb(v[0], v[1], v[2], v[3]);
  // separasjon: full tint er fargen, resten tolkes som sort med den styrken
  if (kind === "sep" && v.length >= 1) {
    const t = 1 - Math.min(1, Math.max(0, v[v.length - 1]));
    return [t, t, t];
  }
  return null;
}

function rgbOp(op: string, tall: number[]): [number, number, number] | null {
  if (op === "g" && tall.length) { const v = tall[tall.length - 1]; return [v, v, v]; }
  if (op === "rg" && tall.length >= 3) return tall.slice(-3) as [number, number, number];
  if (op === "k" && tall.length >= 4) {
    const v = tall.slice(-4);
    return cmykTilRgb(v[0], v[1], v[2], v[3]);
  }
  return null;
}

function cmykTilRgb(c: number, m: number, y: number, k: number): [number, number, number] {
  return [(1 - Math.min(1, c + k)), (1 - Math.min(1, m + k)), (1 - Math.min(1, y + k))];
}

export function tilHex(rgb: [number, number, number]): string {
  const b = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 255)
    .toString(16).padStart(2, "0");
  return `#${b(rgb[0])}${b(rgb[1])}${b(rgb[2])}`.toUpperCase();
}

function hvitScn(kind: CsKind, tall: number[]): boolean | null {
  if (!kind || !tall.length) return null;
  const n = { gray: 1, rgb: 3, cmyk: 4, sep: 1 }[kind];
  const v = tall.slice(-n);
  if (kind === "cmyk") return v.every((x) => x <= 0.01);
  if (kind === "rgb") return v.every((x) => x >= 0.99);
  return kind === "gray" ? v[v.length - 1] >= 0.99 : v[v.length - 1] <= 0.01;
}

function hvitOp(op: string, tall: number[]): boolean | null {
  const o = op.toLowerCase();
  if (o === "g" && tall.length) return tall[tall.length - 1] >= 0.99;
  if (o === "rg" && tall.length >= 3) return tall.slice(-3).every((v) => v >= 0.99);
  if (o === "k" && tall.length >= 4) return tall.slice(-4).every((v) => v <= 0.01);
  return null;
}

const TOKEN = /\/[^\s/[\]<>(){}]+|<<|>>|\[|\]|[^\s[\]<>(){}/]+/g;

interface Malt { ringer: Ring[]; hvit: boolean; hex: string }

function gaa(data: string, res: PDFDict | undefined, ctm: Mat, tol: number,
             dybde: number, ut: Malt[]) {
  const stabel: Mat[] = [];
  const hvitStabel: boolean[] = [];
  const csStabel: CsKind[] = [];
  let cur = ctm;
  let sub: Ring = [];
  let pending: Ring[] = [];
  let pos: [number, number] = [0, 0];
  let start: [number, number] = [0, 0];
  let tall: number[] = [];
  let navn: string | null = null;
  let hvit = false;
  let fillCs: CsKind = null;
  let farge: [number, number, number] = [0, 0, 0];
  const fargeStabel: [number, number, number][] = [];
  // strektilstand
  let sHvit = false;
  let sCs: CsKind = null;
  let sFarge: [number, number, number] = [0, 0, 0];
  let bredde = 1, cap = 0, join = 0, miter = 10;
  const sStabel: { h: boolean; c: CsKind; f: [number, number, number];
                   b: number; ca: number; j: number; m: number }[] = [];
  let lukket: boolean[] = [];
  let naLukket = false;

  const lukk = () => {
    if (sub.length > 2) { pending.push(sub); lukket.push(naLukket); }
    sub = []; naLukket = false;
  };

  const tokens = data.match(TOKEN) ?? [];
  for (const tk of tokens) {
    if (/^[-+]?[\d.]+$/.test(tk)) {
      const v = parseFloat(tk);
      if (!Number.isNaN(v)) tall.push(v);
      continue;
    }
    if (tk.startsWith("/")) { navn = tk.slice(1); continue; }
    const op = tk;

    if (op === "q") {
      stabel.push(cur); hvitStabel.push(hvit); csStabel.push(fillCs); fargeStabel.push(farge);
      sStabel.push({ h: sHvit, c: sCs, f: sFarge, b: bredde, ca: cap, j: join, m: miter });
    } else if (op === "Q") {
      if (stabel.length) {
        cur = stabel.pop()!; hvit = hvitStabel.pop()!;
        fillCs = csStabel.pop()!; farge = fargeStabel.pop()!;
        const s2 = sStabel.pop();
        if (s2) { sHvit = s2.h; sCs = s2.c; sFarge = s2.f; bredde = s2.b;
                  cap = s2.ca; join = s2.j; miter = s2.m; }
      }
    } else if (op === "w" && tall.length) { bredde = tall[tall.length - 1]; }
    else if (op === "J" && tall.length) { cap = tall[tall.length - 1]; }
    else if (op === "j" && tall.length) { join = tall[tall.length - 1]; }
    else if (op === "M" && tall.length) { miter = tall[tall.length - 1]; }
    else if (op === "CS" && navn) { sCs = csType(res, navn); }
    else if (op === "SCN" || op === "SC") {
      const h = hvitScn(sCs, tall);
      if (h !== null) sHvit = h;
      const f = rgbScn(sCs, tall);
      if (f) sFarge = f;
    } else if (op === "cs" && navn) { fillCs = csType(res, navn); }
    else if (op === "scn" || op === "sc") {
      const h = hvitScn(fillCs, tall);
      if (h !== null) hvit = h;
      const f = rgbScn(fillCs, tall);
      if (f) farge = f;
    } else if (op === "cm" && tall.length >= 6) {
      cur = mul(tall.slice(-6) as Mat, cur);
    } else if (op === "m" && tall.length >= 2) {
      lukk(); pos = app(cur, tall[tall.length - 2], tall[tall.length - 1]);
      start = pos; sub = [pos];
    } else if (op === "l" && tall.length >= 2) {
      pos = app(cur, tall[tall.length - 2], tall[tall.length - 1]); sub.push(pos);
    } else if ((op === "c" || op === "v" || op === "y") && tall.length >= 4) {
      let a: [number, number], b: [number, number], c: [number, number];
      if (op === "c" && tall.length >= 6) {
        const n = tall.slice(-6);
        a = app(cur, n[0], n[1]); b = app(cur, n[2], n[3]); c = app(cur, n[4], n[5]);
      } else if (op === "v") {
        const n = tall.slice(-4);
        a = pos; b = app(cur, n[0], n[1]); c = app(cur, n[2], n[3]);
      } else {
        const n = tall.slice(-4);
        a = app(cur, n[0], n[1]); c = app(cur, n[2], n[3]); b = c;
      }
      flat(pos, a, b, c, tol, sub); pos = c;
    } else if (op === "h") { naLukket = true; lukk(); sub = [start]; pos = start; }
    else if (op === "re" && tall.length >= 4) {
      const [x, y, w, h] = tall.slice(-4);
      lukk();
      sub = [app(cur, x, y), app(cur, x + w, y), app(cur, x + w, y + h), app(cur, x, y + h)];
      naLukket = true;
      lukk();
      pos = start = app(cur, x, y);
    } else if (MALE_FYLL.has(op) || MALE_STREK.has(op)) {
      if (SKAL_LUKKES.has(op)) naLukket = true;
      lukk();
      if (pending.length) {
        if (MALE_FYLL.has(op)) ut.push({ ringer: pending, hvit, hex: tilHex(farge) });
        if (MALE_STREK.has(op)) {
          // strekbredden star i brukerrommet og ma folge med skaleringen
          const sk = Math.sqrt(Math.abs(cur[0] * cur[3] - cur[1] * cur[2])) || 1;
          const r = strekTilRinger(pending, lukket, bredde * sk, cap, join, miter);
          if (r.length) ut.push({ ringer: r, hvit: sHvit, hex: tilHex(sFarge) });
        }
      }
      pending = []; lukket = [];
    } else if (MALE_ANNET.has(op)) { lukk(); pending = []; lukket = []; }
    else if (op === "Do" && navn && dybde < 4) {
      const xo = res?.lookup(PDFName.of("XObject"), PDFDict);
      const form: any = xo?.lookup(PDFName.of(navn));
      if (form) {
        const dict: PDFDict = form.dict ?? form;
        if (String(dict.lookup(PDFName.of("Subtype"))) === "/Form") {
          const mArr = dict.lookup(PDFName.of("Matrix"), PDFArray);
          const fm: Mat = mArr ? (mArr.asArray().map((v: any) => v.asNumber()) as Mat) : ID;
          gaa(streamText(form), dict.lookup(PDFName.of("Resources"), PDFDict),
              mul(fm, cur), tol, dybde + 1, ut);
        }
      }
    } else {
      const h = hvitOp(op, tall);
      if (h !== null) hvit = h;
      const f = rgbOp(op, tall);
      if (f) farge = f;
    }
    if (op !== "cs" && op !== "CS") tall = [];
  }
  lukk();
}

function ringAreal(r: Ring): number {
  let a = 0;
  for (let i = 0; i < r.length; i++) {
    const p = r[i], q = r[(i + 1) % r.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return Math.abs(a / 2);
}

function punktInni(p: [number, number], r: Ring): boolean {
  let inne = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, yi] = r[i], [xj, yj] = r[j];
    if ((yi > p[1]) !== (yj > p[1]) &&
        p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inne = !inne;
  }
  return inne;
}

/**
 * Flere delbaner i samme bane. En delbane som ligger inni en storre er et hull.
 *
 * Her sto det tidligere xor. Det er feil naar to delbaner overlapper uten at
 * den ene ligger inni den andre, slik skriftsnitt med sammenbundne bokstaver
 * gjor: xor slar hull der de krysser hverandre. Klinikk Saetran ble 35 flater
 * i stedet for 22 med den varianten.
 */
function nestRinger(ringer: Ring[]): MultiPoly {
  // Ringer kan ligge dypere enn ett niva: en kontur rundt innmaten i A ligger
  // inni hullet i bokstaven. Dybde bestemmer om ringen er flate eller hull.
  const R = ringer.map((r) => ({ r, a: Math.abs(ringAreal(r)) }));
  R.sort((x, y) => y.a - x.a);
  const dybde = R.map((_, i) => {
    let d = 0;
    for (let j = 0; j < R.length; j++) if (j !== i && R[j].a > R[i].a && punktInni(R[i].r[0], R[j].r)) d++;
    return d;
  });
  const deler: MultiPoly = [];
  for (let i = 0; i < R.length; i++) {
    if (dybde[i] % 2 !== 0) continue;                 // odde dybde = hull
    const hull: Ring[] = [];
    for (let j = 0; j < R.length; j++) {
      if (dybde[j] !== dybde[i] + 1) continue;
      if (punktInni(R[j].r[0], R[i].r)) hull.push(R[j].r);
    }
    deler.push([R[i].r, ...hull]);
  }
  return deler;
}

function lukkRing(r: Ring): Ring {
  if (r.length < 3) return r;
  const a = r[0], b = r[r.length - 1];
  return a[0] === b[0] && a[1] === b[1] ? r : [...r, a];
}

export interface Geometri {
  flate: MultiPoly;
  baner: number;
  levendeTekst: boolean;
  bbox: [number, number, number, number];
}

async function lesMalt(pdf: Uint8Array, skala: number, sagMm: number) {
  const doc = await PDFDocument.load(pdf, { ignoreEncryption: true });
  const levendeTekst = doc.getPages().some((p) => {
    const r: any = (p.node as any).Resources?.();
    return !!r?.lookup(PDFName.of("Font"));
  });

  const page: any = doc.getPage(0);
  let innhold = "";
  const c = page.node.Contents();
  if (c) {
    if (c instanceof PDFArray) {
      for (const r of c.asArray()) innhold += streamText(doc.context.lookup(r)) + "\n";
    } else innhold += streamText(c);
  }

  const tolPt = ((sagMm / 25.4) * 72) / Math.max(skala, 1e-9);
  const tol = (4 * tolPt) ** 2;
  const malt: Malt[] = [];
  gaa(innhold, page.node.Resources(), ID, tol, 0, malt);
  return { malt, levendeTekst };
}

function boksen(flate: MultiPoly): [number, number, number, number] {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const poly of flate) for (const ring of poly) for (const [x, y] of ring) {
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  return [x0, y0, x1, y1];
}

/** Ringene i en maleoperasjon, med hull nestet riktig. */
function somFlate(m: Malt): MultiPoly {
  const ringer = m.ringer.filter((r) => r.length > 2).map(lukkRing);
  return ringer.length ? nestRinger(ringer) : [];
}

export async function hentGeometri(
  pdf: Uint8Array, skala: number, sagMm = 0.02
): Promise<Geometri> {
  const { malt, levendeTekst } = await lesMalt(pdf, skala, sagMm);

  // malerens rekkefolge, gruppert sa like operasjoner slas sammen forst
  let flate: MultiPoly = [];
  let i = 0;
  while (i < malt.length) {
    const hvit = malt[i].hvit;
    const gruppe: MultiPoly = [];
    while (i < malt.length && malt[i].hvit === hvit) {
      const ringer = malt[i].ringer.filter((r) => r.length > 2).map(lukkRing);
      if (ringer.length) {
        const deler = nestRinger(ringer);
        if (deler.length) gruppe.push(...deler);
      }
      i++;
    }
    if (!gruppe.length) continue;
    const samlet = gruppe.length === 1 ? gruppe : (pc.union(...gruppe.map((g) => [g] as any)) as MultiPoly);
    if (hvit) {
      if (flate.length) flate = pc.difference(flate as any, samlet as any) as MultiPoly;
    } else {
      flate = flate.length ? (pc.union(flate as any, samlet as any) as MultiPoly) : samlet;
    }
  }

  return { flate, baner: malt.length, levendeTekst, bbox: boksen(flate) };
}

export interface FargeLag {
  /** fargen slik den star i filen */
  hex: string;
  /**
   * Hvitt er tvetydig. Det kan vaere en egen folie, og det kan vaere et
   * utsnitt der underlaget skal vises. Motoren melder det som en farge og
   * lar brukeren bestemme.
   */
  hvit: boolean;
  flate: MultiPoly;
  /** andel av motivets samlede areal, 0 til 1 */
  andel: number;
}

export interface GeometriPerFarge {
  /** oyverste lag forst, altsa omvendt av malerrekkefolgen */
  lag: FargeLag[];
  levendeTekst: boolean;
  /** boksen om hele motivet, alle farger sett under ett */
  bbox: [number, number, number, number];
}

/**
 * Deler motivet i ett lag per farge, i malerens rekkefolge.
 *
 * En bane som males oppa en annen, dekker den, uansett farge. Derfor trekkes
 * hver ny bane fra alle lag som ligger under, og legges bare til sitt eget.
 * Hvitt legger ingen folie, det bare fjerner.
 *
 * Lagene kommer i motsatt malerrekkefolge, altsa det oyverste laget forst.
 * Det er den rekkefolgen produksjonen bryr seg om: oyverste folie legges
 * sist og er den som styrer registreringen.
 */
export async function hentGeometriPerFarge(
  pdf: Uint8Array, skala: number, sagMm = 0.02
): Promise<GeometriPerFarge> {
  const { malt, levendeTekst } = await lesMalt(pdf, skala, sagMm);

  const brukt = malt;

  const lag = new Map<string, MultiPoly>();
  const hvite = new Map<string, boolean>();
  let i = 0;
  while (i < brukt.length) {
    const hex = brukt[i].hex;
    const hvit = brukt[i].hvit;
    const gruppe: MultiPoly = [];
    while (i < brukt.length && brukt[i].hex === hex && brukt[i].hvit === hvit) {
      gruppe.push(...somFlate(brukt[i]));
      i++;
    }
    if (!gruppe.length) continue;
    const samlet = gruppe.length === 1
      ? gruppe : (pc.union(...gruppe.map((g) => [g] as any)) as MultiPoly);

    for (const [k, v] of lag) {
      if (k === hex || !v.length) continue;
      lag.set(k, pc.difference(v as any, samlet as any) as MultiPoly);
    }
    // hvitt legges til som et lag pa linje med de andre. At det dekker det
    // som ligger under, er allerede tatt hoyde for over.
    const fra = lag.get(hex);
    lag.set(hex, fra && fra.length
      ? (pc.union(fra as any, samlet as any) as MultiPoly) : samlet);
    hvite.set(hex, hvit);
  }

  const ut: FargeLag[] = [];
  let sum = 0;
  for (const [hex, flate] of lag) {
    if (!flate.length) continue;
    const a = areal(flate);
    if (a <= 0) continue;
    ut.push({ hex, hvit: hvite.get(hex) ?? false, flate, andel: a });
    sum += a;
  }
  for (const l of ut) l.andel = sum > 0 ? l.andel / sum : 0;
  ut.reverse();   // oyverst forst

  const alle: MultiPoly = ut.flatMap((l) => l.flate);
  return { lag: ut, levendeTekst, bbox: boksen(alle) };
}

/** Areal med hull trukket fra. */
export function areal(mp: MultiPoly): number {
  let sum = 0;
  for (const poly of mp) {
    poly.forEach((ring, k) => {
      let a = 0;
      for (let i = 0; i < ring.length; i++) {
        const p = ring[i], q = ring[(i + 1) % ring.length];
        a += p[0] * q[1] - q[0] * p[1];
      }
      sum += (k === 0 ? 1 : -1) * Math.abs(a / 2);
    });
  }
  return sum;
}

/** Samlet lengde av alle konturer, ytre og hull. */
export function omkrets(mp: MultiPoly): number {
  let sum = 0;
  for (const poly of mp) for (const ring of poly) {
    for (let i = 0; i < ring.length; i++) {
      const p = ring[i], q = ring[(i + 1) % ring.length];
      sum += Math.hypot(q[0] - p[0], q[1] - p[1]);
    }
  }
  return sum;
}

export function antallHull(mp: MultiPoly): number {
  return mp.reduce((n, poly) => n + Math.max(0, poly.length - 1), 0);
}
