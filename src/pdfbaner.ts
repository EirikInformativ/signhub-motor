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

/* ---------- fargerom ---------- */

/**
 * Et fargerom, redusert til det motoren trenger: hvor mange komponenter
 * scn tar inn, og hvordan de blir rgb.
 *
 * Spotfarger skal aldri tolkes som sort med en styrke. Gjor man det,
 * faller to Pantone-farger sammen til ett sort lag, og separeringen
 * mister et helt folielag. Tinten skal gjennom tintTransform og
 * alternativfargerommet.
 */
interface Cs {
  /** antall komponenter scn tar */
  n: number;
  tilRgb(v: number[]): [number, number, number] | null;
}

const klem = (v: number, lo: number, hi: number) =>
  Math.min(Math.max(v, Math.min(lo, hi)), Math.max(lo, hi));

const interp = (x: number, a0: number, a1: number, b0: number, b1: number) =>
  a1 === a0 ? b0 : b0 + ((x - a0) * (b1 - b0)) / (a1 - a0);

const CS_GRAY: Cs = { n: 1, tilRgb: (v) => [v[0], v[0], v[0]] };
const CS_RGB: Cs = { n: 3, tilRgb: (v) => [v[0], v[1], v[2]] };
const CS_CMYK: Cs = { n: 4, tilRgb: (v) => cmykTilRgb(v[0], v[1], v[2], v[3]) };

/** D50, slik Lab-fargerom i PDF nesten alltid er stilt inn. */
const D50: [number, number, number] = [0.964203, 1, 0.824905];

/** XYZ under D50 til lineaer sRGB, Bradford-tilpasset. */
const XYZ_SRGB: number[][] = [
  [3.1338561, -1.6168667, -0.4906146],
  [-0.9787684, 1.9161415, 0.0334540],
  [0.0719453, -0.2289914, 1.4052427],
];

function srgbGamma(c: number): number {
  const x = klem(c, 0, 1);
  return x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
}

/**
 * Lab til rgb. Hvitpunktet leses av fila naar det staar der; ellers D50.
 * Uten dette blir en Pantone med Lab-alternativ feil farge, og to Pantoner
 * kan havne saa naer hverandre at de slaas sammen.
 */
function labTilRgb(L: number, a: number, b: number,
                   wp: [number, number, number] = D50): [number, number, number] {
  const fy = (L + 16) / 116;
  const fx = fy + a / 500;
  const fz = fy - b / 200;
  const d = 6 / 29;
  const g = (t: number) => (t > d ? t * t * t : 3 * d * d * (t - 4 / 29));
  const X = wp[0] * g(fx), Y = wp[1] * g(fy), Z = wp[2] * g(fz);
  const m = XYZ_SRGB;
  return [
    srgbGamma(m[0][0] * X + m[0][1] * Y + m[0][2] * Z),
    srgbGamma(m[1][0] * X + m[1][1] * Y + m[1][2] * Z),
    srgbGamma(m[2][0] * X + m[2][1] * Y + m[2][2] * Z),
  ];
}

/** En PDFDict har lookup selv; en strom har den paa .dict. */
function dictAv(obj: any): any {
  return obj && typeof obj.lookup === "function" ? obj : obj?.dict;
}

function tallAv(d: any, navn: string): number | null {
  const v: any = d?.lookup?.(PDFName.of(navn));
  const n = v?.asNumber?.();
  return typeof n === "number" && !Number.isNaN(n) ? n : null;
}

function tallListe(d: any, navn: string): number[] | null {
  const a: any = d?.lookup?.(PDFName.of(navn));
  if (!(a instanceof PDFArray)) return null;
  const ut: number[] = [];
  for (let i = 0; i < a.size(); i++) {
    const n = (a.lookup(i) as any)?.asNumber?.();
    if (typeof n !== "number" || Number.isNaN(n)) return null;
    ut.push(n);
  }
  return ut;
}

function navnListe(a: any): string[] {
  if (!(a instanceof PDFArray)) return [];
  const ut: string[] = [];
  for (let i = 0; i < a.size(); i++) ut.push(String(a.lookup(i)).replace(/^\//, ""));
  return ut;
}

/**
 * Tolker en PDF-funksjon til (t) => utverdier.
 *
 * Type 2 er eksponentiell interpolasjon, type 3 syr sammen flere, type 0
 * er en samplet tabell med en inngang. Type 4 er PostScript-kalkulator og
 * tolkes ikke; da gis null, og den som spor faller tilbake paa
 * reserveFarge.
 */
function lagFn(obj: any): ((t: number) => number[]) | null {
  const d = dictAv(obj);
  if (!d) return null;
  const typ = tallAv(d, "FunctionType");
  const dom = tallListe(d, "Domain") ?? [0, 1];

  if (typ === 2) {
    const c0 = tallListe(d, "C0") ?? [0];
    const c1 = tallListe(d, "C1") ?? [1];
    const N = tallAv(d, "N") ?? 1;
    const m = Math.min(c0.length, c1.length);
    if (m < 1) return null;
    return (t) => {
      const p = Math.pow(klem(t, dom[0], dom[1]), N);
      const ut: number[] = [];
      for (let i = 0; i < m; i++) ut.push(c0[i] + p * (c1[i] - c0[i]));
      return ut;
    };
  }

  if (typ === 3) {
    const arr: any = d.lookup(PDFName.of("Functions"));
    if (!(arr instanceof PDFArray) || arr.size() < 1) return null;
    const under: ((t: number) => number[])[] = [];
    for (let i = 0; i < arr.size(); i++) {
      const f = lagFn(arr.lookup(i));
      if (!f) return null;
      under.push(f);
    }
    const grenser = tallListe(d, "Bounds") ?? [];
    const enc = tallListe(d, "Encode") ?? [];
    return (t) => {
      const x = klem(t, dom[0], dom[1]);
      let i = 0;
      while (i < grenser.length && x >= grenser[i]) i++;
      if (i > under.length - 1) i = under.length - 1;
      const lav = i === 0 ? dom[0] : grenser[i - 1];
      const hoy = i === under.length - 1 ? dom[1] : grenser[i];
      const e0 = enc.length > 2 * i ? enc[2 * i] : 0;
      const e1 = enc.length > 2 * i + 1 ? enc[2 * i + 1] : 1;
      return under[i](interp(x, lav, hoy, e0, e1));
    };
  }

  if (typ === 0 && obj instanceof PDFRawStream) {
    const stor = tallListe(d, "Size");
    const bps = tallAv(d, "BitsPerSample");
    const omraade = tallListe(d, "Range");
    if (!stor || stor.length !== 1 || !bps || bps < 1 || bps > 32 || !omraade) return null;
    const m = omraade.length >> 1;
    if (m < 1) return null;
    const antall = Math.max(2, Math.floor(stor[0]));
    let raa: Uint8Array;
    try { raa = decodePDFRawStream(obj).decode(); } catch { return null; }
    const maks = Math.pow(2, bps) - 1;
    const les = (i: number, j: number): number => {
      let bit = (i * m + j) * bps;
      let v = 0;
      for (let k = 0; k < bps; k++, bit++) {
        const byte = raa[bit >> 3];
        if (byte === undefined) return 0;
        v = v * 2 + ((byte >> (7 - (bit & 7))) & 1);
      }
      return v;
    };
    const enc = tallListe(d, "Encode") ?? [0, antall - 1];
    const dec = tallListe(d, "Decode") ?? omraade;
    return (t) => {
      const x = klem(t, dom[0], dom[1]);
      const e = klem(interp(x, dom[0], dom[1], enc[0], enc[1]), 0, antall - 1);
      const i0 = Math.floor(e);
      const i1 = Math.min(antall - 1, i0 + 1);
      const brok = e - i0;
      const ut: number[] = [];
      for (let j = 0; j < m; j++) {
        const s = les(i0, j) * (1 - brok) + les(i1, j) * brok;
        const d0 = dec[2 * j] ?? 0, d1 = dec[2 * j + 1] ?? 1;
        ut.push(d0 + (s / maks) * (d1 - d0));
      }
      return ut;
    };
  }

  return null;
}

/**
 * Naar tintTransform ikke lar seg tolke, for eksempel FunctionType 4,
 * skal separasjonen likevel fa sin egen farge. Sort ville gjort at to
 * spotfarger falt sammen til ett lag. Fargen utledes av navnet, saa den er
 * stabil mellom kjoringer, og er lys nok til ikke aa forveksles med sort.
 */
function reserveFarge(navn: string): [number, number, number] {
  let h = 2166136261;
  for (let i = 0; i < navn.length; i++) {
    h ^= navn.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const seks = ((h >>> 0) % 360) / 60;
  const s = 0.62, l = 0.46;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs((seks % 2) - 1));
  const m = l - c / 2;
  const t: [number, number, number] =
    seks < 1 ? [c, x, 0] : seks < 2 ? [x, c, 0] : seks < 3 ? [0, c, x] :
    seks < 4 ? [0, x, c] : seks < 5 ? [x, 0, c] : [c, 0, x];
  return [t[0] + m, t[1] + m, t[2] + m];
}

function csFraObj(res: PDFDict | undefined, navn: string): Cs | null {
  if (navn === "DeviceCMYK") return CS_CMYK;
  if (navn === "DeviceRGB") return CS_RGB;
  if (navn === "DeviceGray") return CS_GRAY;
  const csres = res?.lookup(PDFName.of("ColorSpace"), PDFDict);
  return csFraVerdi(csres?.lookup(PDFName.of(navn)), res);
}

function csFraVerdi(obj: any, res: PDFDict | undefined): Cs | null {
  if (!obj) return null;
  try {
    if (obj instanceof PDFName) return csFraObj(res, String(obj).slice(1));
    if (!(obj instanceof PDFArray) || obj.size() < 1) return null;
    const fam = String(obj.lookup(0)).slice(1);

    if (fam === "DeviceCMYK") return CS_CMYK;
    if (fam === "DeviceRGB") return CS_RGB;
    if (fam === "DeviceGray") return CS_GRAY;
    if (fam === "CalRGB") return CS_RGB;
    if (fam === "CalGray") return CS_GRAY;

    if (fam === "ICCBased") {
      const n = tallAv(dictAv(obj.lookup(1)), "N") ?? 3;
      return n === 1 ? CS_GRAY : n === 4 ? CS_CMYK : CS_RGB;
    }

    if (fam === "Lab") {
      const wp = tallListe(dictAv(obj.lookup(1)), "WhitePoint");
      const w: [number, number, number] =
        wp && wp.length === 3 && wp[1] > 0 ? [wp[0], wp[1], wp[2]] : D50;
      return { n: 3, tilRgb: (v) => labTilRgb(v[0], v[1], v[2], w) };
    }

    if (fam === "Separation" || fam === "DeviceN") {
      const del = obj.lookup(1);
      const antall = fam === "Separation" ? 1
        : del instanceof PDFArray ? Math.max(1, del.size()) : 1;
      const alt = csFraVerdi(obj.lookup(2), res);
      const fn = lagFn(obj.lookup(3));
      const merke = fam === "Separation"
        ? String(del ?? "").replace(/^\//, "")
        : navnListe(del).join("+");

      if (alt && fn && antall === 1) {
        return { n: 1, tilRgb: (v) => {
          const u = fn(klem(v[0], 0, 1));
          return u.length >= alt.n ? alt.tilRgb(u.slice(0, alt.n)) : null;
        } };
      }

      // tintTransform lar seg ikke tolke: gi separasjonen sin egen farge,
      // interpolert fra hvitt ved tint 0.
      const base = reserveFarge(merke);
      return { n: antall, tilRgb: (v) => {
        const t = klem(Math.max(...v.slice(0, antall)), 0, 1);
        return [1 - t * (1 - base[0]), 1 - t * (1 - base[1]), 1 - t * (1 - base[2])];
      } };
    }
  } catch { /* ukjent fargerom */ }
  return null;
}

/** Fargen som rgb 0..1, saa fargeseparering vet hva som er hva. */
function rgbScn(cs: Cs | null, tall: number[]): [number, number, number] | null {
  if (!cs || !tall.length) return null;
  const v = tall.slice(-cs.n);
  if (v.length < cs.n) return null;
  try {
    const f = cs.tilRgb(v);
    if (!f || f.some((x) => typeof x !== "number" || Number.isNaN(x))) return null;
    return [klem(f[0], 0, 1), klem(f[1], 0, 1), klem(f[2], 0, 1)];
  } catch { return null; }
}

/** Hvitt avgjores av fargen, ikke av fargeromtypen. */
function hvitFraRgb(rgb: [number, number, number]): boolean {
  return rgb[0] >= 0.99 && rgb[1] >= 0.99 && rgb[2] >= 0.99;
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

export function cmykTilRgb(c: number, m: number, y: number, k: number): [number, number, number] {
  return [(1 - Math.min(1, c + k)), (1 - Math.min(1, m + k)), (1 - Math.min(1, y + k))];
}

export function tilHex(rgb: [number, number, number]): string {
  const b = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 255)
    .toString(16).padStart(2, "0");
  return `#${b(rgb[0])}${b(rgb[1])}${b(rgb[2])}`.toUpperCase();
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
  const csStabel: (Cs | null)[] = [];
  let cur = ctm;
  let sub: Ring = [];
  let pending: Ring[] = [];
  let pos: [number, number] = [0, 0];
  let start: [number, number] = [0, 0];
  let tall: number[] = [];
  let navn: string | null = null;
  let hvit = false;
  let fillCs: Cs | null = null;
  let farge: [number, number, number] = [0, 0, 0];
  const fargeStabel: [number, number, number][] = [];
  // strektilstand
  let sHvit = false;
  let sCs: Cs | null = null;
  let sFarge: [number, number, number] = [0, 0, 0];
  let bredde = 1, cap = 0, join = 0, miter = 10;
  const sStabel: { h: boolean; c: Cs | null; f: [number, number, number];
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
    else if (op === "CS" && navn) { sCs = csFraObj(res, navn); }
    else if (op === "SCN" || op === "SC") {
      const f = rgbScn(sCs, tall);
      if (f) { sFarge = f; sHvit = hvitFraRgb(f); }
    } else if (op === "cs" && navn) { fillCs = csFraObj(res, navn); }
    else if (op === "scn" || op === "sc") {
      const f = rgbScn(fillCs, tall);
      if (f) { farge = f; hvit = hvitFraRgb(f); }
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

/**
 * Morfologisk lukking: blaas formen ut med delta, og trekk den inn igjen.
 *
 * En farge som ligger i en apen renne i fargen under, ligger ikke i et
 * hull. Regelen om at et lag fyller igjen hullene innenfor egen form ser
 * derfor ingenting, og det smale sporet blir skaret bort fra det
 * underliggende laget i stedet for a bli lagt oppa. Lukkingen lukker igjen
 * renner som er smalere enn delta, sa de teller som innenfor formen.
 *
 * Lukking kan bare fylle renner som allerede finnes i formen. Utblasingen
 * tas inn igjen med samme delta, sa formen brer seg ikke ut til noe som
 * ligger ved siden av.
 */
/**
 * Rydder bort nullbrede pigger og kollineare spor fra en flate.
 *
 * Nar to flater deler en kant noyaktig, kan polygon-clipping legge igjen
 * en bane som gar ut og rett tilbake langs samme linje. Den har null
 * areal, men den tegnes som skjaerelinje, og da star det en unodvendig
 * strek midt i et helt element. Pa Nytveit sto piggen midt i den blaa
 * stripen: subbanen gikk (118.9284, 99.6053) -> (52.1789, 99.4038) og
 * rett tilbake igjen.
 *
 * Piggen er skalaavhengig. Den samme logoen gav pigg ved 500 mm
 * elementbredde, men ikke ved 200, 300, 400, 460 eller 560. Slikt maa
 * derfor proves ved flere bredder, ikke bare en.
 *
 * SimplifyPolygons loser opp selvkryssinger og kollineare spor,
 * CleanPolygons fjerner punkter som ligger naermere enn en rutenettsenhet.
 */
export function ryddFlate(mp: MultiPoly): MultiPoly {
  if (!mp.length) return mp;
  const S = 1e4;
  try {
    const baner: any[] = [];
    for (const poly of mp) for (const r of poly) {
      if (r.length < 3) continue;
      baner.push(lukkRing(r).map(([x, y]) => ({ X: Math.round(x * S), Y: Math.round(y * S) })));
    }
    if (!baner.length) return mp;
    const enkel = ClipperLib.Clipper.SimplifyPolygons(
      baner, ClipperLib.PolyFillType.pftNonZero);
    if (!enkel || !enkel.length) return mp;
    const rent = ClipperLib.Clipper.CleanPolygons(enkel, 1);
    if (!rent || !rent.length) return mp;
    const ringer: Ring[] = rent
      .map((b: any[]) => lukkRing(b.map((q) => [q.X / S, q.Y / S] as [number, number])))
      .filter((r: Ring) => r.length > 2);
    if (!ringer.length) return mp;
    return nestRinger(ringer);
  } catch {
    return mp;   // clipper klarte det ikke; da star flaten som den er
  }
}

/**
 * Vakt rundt kuttingen per element og farge.
 *
 * polygon-clipping kan miste tellingen paa hakkete geometri og kaste
 * «Unable to find segment #52671 25.377125, 10.503875 til
 * 25.401951614863158, 10.524788266040684 in SweepLine tree» rett ut i
 * appen. Vi saa den paa bakgrunnsplaten i Rosen-logoen: 73 prosent av
 * motivet, 13 biter, og hver bit full av korte segmenter fra bokstavene
 * som er stanset ut av den.
 *
 * Bakgrunnsplaten skjaeres ikke lenger, se erBakgrunnsplate i
 * src/bilmotor.ts, saa den aarsaken er borte. Men motoren skal ikke
 * kunne kastes ut med en raa biblioteksfeil uansett hva slags fil som
 * kommer inn. Foerste forsoek gaar paa geometrien som den er. Feiler
 * det, ryddes hver operand med ryddFlate og forsoeket gjentas en gang.
 * Gaar det fortsatt ikke, kastes en feil som sier hvilket element og
 * hvilken farge det gjelder.
 *
 * Den raa teksten fra biblioteket logges til konsollen for feilsoking,
 * men naar aldri fram til brukeren. Brukeren skal aldri se SweepLine
 * tree.
 */
export function kuttTrygt(
  el: string,
  farge: string,
  op: (...flater: MultiPoly[]) => MultiPoly,
  ...flater: MultiPoly[]
): MultiPoly {
  try {
    return op(...flater);
  } catch (forste: any) {
    console.warn(`${el || "fargesepareringen"} / ${farge}: kuttingen feilet ` +
      `(${kortFeil(forste)}). ` +
      "Proever en gang til med ryddet geometri.");
    try {
      return op(...flater.map((f) => ryddFlate(f)));
    } catch (andre: any) {
      console.error(`${el || "fargesepareringen"} / ${farge}: kuttingen ` +
        `feilet ogsaa etter ` +
        `opprydding (${kortFeil(andre)}).`);
      throw new Error(
        `${el ? el + ": klarte" : "Klarte"} ikke skjaere fargen ${farge}. ` +
        "Geometrien i denne " +
        "flaten er saa oppdelt at motoren ikke far kuttet den, heller ikke " +
        "etter opprydding. Ligger fargen som en bakgrunnsplate bak motivet, " +
        "skal den ikke skjaeres i folie, men settes til negativt.");
    }
  }
}

/** Kort, ufarlig sammendrag av en biblioteksfeil, til konsollen. */
function kortFeil(e: any): string {
  const m = String(e?.message ?? e ?? "ukjent feil");
  return m.length > 120 ? m.slice(0, 117) + "..." : m;
}

export function lukkGlipper(mp: MultiPoly, delta: number): MultiPoly {
  if (!(delta > 0) || !mp.length) return mp;
  const S = 1e4;
  const tilClipper = (ringer: Ring[]) =>
    ringer.filter((r) => r.length > 2).map((r) =>
      lukkRing(r).map(([x, y]) => ({ X: Math.round(x * S), Y: Math.round(y * S) })));

  const alle: Ring[] = [];
  for (const poly of mp) for (const r of poly) alle.push(r);
  const inn = tilClipper(alle);
  if (!inn.length) return mp;

  const ut = (baner: any[], d: number): any[] => {
    const co = new ClipperLib.ClipperOffset(2, 0.25);
    co.AddPaths(baner, ClipperLib.JoinType.jtMiter,
                ClipperLib.EndType.etClosedPolygon);
    const res: any[] = [];
    co.Execute(res, d * S);
    return res;
  };

  try {
    const blast = ut(inn, delta);
    if (!blast.length) return mp;
    const krympet = ut(blast, -delta);
    if (!krympet.length) return mp;
    const ringer: Ring[] = krympet
      .map((b: any[]) => lukkRing(b.map((q) => [q.X / S, q.Y / S] as [number, number])))
      .filter((r: Ring) => r.length > 2);
    if (!ringer.length) return mp;
    return nestRinger(ringer);
  } catch {
    return mp;   // clipper klarte det ikke; da star formen som den er
  }
}

export interface Geometri {
  flate: MultiPoly;
  baner: number;
  levendeTekst: boolean;
  bbox: [number, number, number, number];
}

/**
 * Sann bare naar siden faktisk viser tekst. En ubrukt fontressurs i
 * ordboken teller ikke, for da er det ingenting a konvertere til baner.
 */
function harTekst(data: string, res: PDFDict | undefined, dybde: number): boolean {
  let d = data.replace(/\\./g, " ");
  let f = d;
  do { d = f; f = d.replace(/\([^()]*\)/g, " "); } while (f !== d);
  d = d.replace(/<[0-9A-Fa-f\s]*>/g, " ");
  if (/(^|[\s\]])(Tj|TJ|'|")(?=\s|$)/.test(d)) return true;
  if (dybde >= 6) return false;
  const xo: any = res?.lookup(PDFName.of("XObject"));
  if (!(xo instanceof PDFDict)) return false;
  for (const n of xo.keys()) {
    const form: any = xo.lookup(n);
    const dict: PDFDict | undefined = form?.dict ?? form;
    if (!dict || String(dict.lookup(PDFName.of("Subtype"))) !== "/Form") continue;
    const r2: any = dict.lookup(PDFName.of("Resources"));
    if (harTekst(streamText(form), r2 instanceof PDFDict ? r2 : res, dybde + 1)) return true;
  }
  return false;
}

async function lesMalt(pdf: Uint8Array, skala: number, sagMm: number) {
  const doc = await PDFDocument.load(pdf, { ignoreEncryption: true });
  const page: any = doc.getPage(0);
  let innhold = "";
  const c = page.node.Contents();
  if (c) {
    if (c instanceof PDFArray) {
      for (const r of c.asArray()) innhold += streamText(doc.context.lookup(r)) + "\n";
    } else innhold += streamText(c);
  }

  const levendeTekst = harTekst(innhold, page.node.Resources(), 0);

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
      if (flate.length) flate = kuttTrygt("", "motivet",
        (a, b) => pc.difference(a as any, b as any) as MultiPoly, flate, samlet);
    } else {
      flate = flate.length ? kuttTrygt("", "motivet",
        (a, b) => pc.union(a as any, b as any) as MultiPoly, flate, samlet) : samlet;
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
      lag.set(k, kuttTrygt("", k,
        (a, b) => pc.difference(a as any, b as any) as MultiPoly, v, samlet));
    }
    // hvitt legges til som et lag pa linje med de andre. At det dekker det
    // som ligger under, er allerede tatt hoyde for over.
    const fra = lag.get(hex);
    lag.set(hex, fra && fra.length
      ? kuttTrygt("", hex,
          (a, b) => pc.union(a as any, b as any) as MultiPoly, fra, samlet)
      : samlet);
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
