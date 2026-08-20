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

/**
 * Et fargerom, redusert til det motoren trenger: hvor mange komponenter
 * operatoren tar, og hvordan de blir til rgb.
 *
 * Spotfarger er ikke sort med en styrke. Separation og DeviceN har en
 * tintTransform som gjor tinten om til en faktisk farge i et alternativt
 * fargerom. Uten den blir to ulike Pantone-farger like, og en tofarget
 * logo kommer inn som ett lag i stedet for to.
 */
interface Cs {
  n: number;
  tilRgb(v: number[]): [number, number, number] | null;
}
type CsKind = Cs | null;

const CS_GRAY: Cs = { n: 1, tilRgb: (v) => [v[0], v[0], v[0]] };
const CS_RGB: Cs = { n: 3, tilRgb: (v) => [v[0], v[1], v[2]] };
const CS_CMYK: Cs = { n: 4, tilRgb: (v) => cmykTilRgb(v[0], v[1], v[2], v[3]) };

/** Lab til sRGB. Hvitpunktet star i filen; Illustrator bruker D50. */
function labTilRgb(L: number, a: number, b: number,
                   wp: number[] = [0.964203, 1, 0.824905]): [number, number, number] {
  const fy = (L + 16) / 116, fx = fy + a / 500, fz = fy - b / 200;
  const f = (t: number) => (t * t * t > 0.008856 ? t * t * t : (t - 16 / 116) / 7.787);
  const X = wp[0] * f(fx), Y = wp[1] * f(fy), Z = wp[2] * f(fz);
  const lin = [
    3.1338561 * X - 1.6168667 * Y - 0.4906146 * Z,
    -0.9787684 * X + 1.9161415 * Y + 0.0334540 * Z,
    0.0719453 * X - 0.2289914 * Y + 1.4052427 * Z,
  ];
  const s = (u: number) => {
    const c = Math.min(1, Math.max(0, u));
    return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  };
  return [s(lin[0]), s(lin[1]), s(lin[2])];
}

function tallArr(o: any): number[] | null {
  const a = o?.asArray ? o.asArray() : null;
  if (!a) return null;
  return a.map((x: any) => (typeof x?.asNumber === "function" ? x.asNumber() : Number(String(x))));
}

type TintFn = (inn: number[]) => number[] | null;

/**
 * PDF-funksjoner, nok av dem til a dekke det Illustrator og InDesign
 * legger igjen: type 2 eksponentiell, type 3 sammensatt, type 0 samplet.
 * Type 4 (PostScript) er ikke tolket; da faller vi tilbake pa reservefarge.
 */
function lagFn(ctx: any, obj: any): TintFn | null {
  try {
    // En PDFDict har selv lookup; en strom har den pa .dict.
    const d: any = typeof obj?.lookup === "function" ? obj : obj?.dict;
    if (typeof d?.lookup !== "function") return null;
    const type = d.lookup(PDFName.of("FunctionType"))?.asNumber?.();
    const domain = tallArr(d.lookup(PDFName.of("Domain"))) ?? [0, 1];

    if (type === 2) {
      const c0 = tallArr(d.lookup(PDFName.of("C0"))) ?? [0];
      const c1 = tallArr(d.lookup(PDFName.of("C1"))) ?? [1];
      const n = d.lookup(PDFName.of("N"))?.asNumber?.() ?? 1;
      return (inn) => {
        const x = Math.min(domain[1], Math.max(domain[0], inn[0] ?? 0));
        const p = Math.pow(x, n);
        return c0.map((v, i) => v + p * ((c1[i] ?? 0) - v));
      };
    }

    if (type === 3) {
      const fnArr: any = d.lookup(PDFName.of("Functions"));
      const raa = fnArr?.asArray ? fnArr.asArray() : null;
      if (!raa) return null;
      const fns = raa.map((r: any) => lagFn(ctx, ctx?.lookup ? ctx.lookup(r) ?? r : r));
      if (fns.some((f: any) => !f)) return null;
      const bounds = tallArr(d.lookup(PDFName.of("Bounds"))) ?? [];
      const enc = tallArr(d.lookup(PDFName.of("Encode"))) ?? [];
      return (inn) => {
        const x = Math.min(domain[1], Math.max(domain[0], inn[0] ?? 0));
        let k = 0;
        while (k < bounds.length && x >= bounds[k]) k++;
        const lo = k === 0 ? domain[0] : bounds[k - 1];
        const hi = k === bounds.length ? domain[1] : bounds[k];
        const e0 = enc[2 * k] ?? 0, e1 = enc[2 * k + 1] ?? 1;
        const xx = hi === lo ? e0 : e0 + ((x - lo) / (hi - lo)) * (e1 - e0);
        return fns[k]([xx]);
      };
    }

    if (type === 0) {
      const size = tallArr(d.lookup(PDFName.of("Size"))) ?? [];
      const range = tallArr(d.lookup(PDFName.of("Range"))) ?? [];
      if (size.length !== 1 || !range.length) return null;   // bare en inngang
      const bps = d.lookup(PDFName.of("BitsPerSample"))?.asNumber?.() ?? 8;
      const m = size[0], nOut = range.length / 2;
      const enc = tallArr(d.lookup(PDFName.of("Encode"))) ?? [0, m - 1];
      const dec = tallArr(d.lookup(PDFName.of("Decode"))) ?? range;
      const bytes: Uint8Array | null = obj instanceof PDFRawStream
        ? decodePDFRawStream(obj).decode()
        : (obj?.getContents ? obj.getContents() : null);
      if (!bytes) return null;
      const maks = Math.pow(2, bps) - 1;
      const les = (i: number) => {
        let v = 0;
        for (let k = 0; k < bps; k++) {
          const b = i * bps + k;
          v = v * 2 + ((bytes[b >> 3] >> (7 - (b & 7))) & 1);
        }
        return v;
      };
      return (inn) => {
        const x = Math.min(domain[1], Math.max(domain[0], inn[0] ?? 0));
        const spenn = domain[1] - domain[0] || 1;
        let e = enc[0] + ((x - domain[0]) / spenn) * (enc[1] - enc[0]);
        e = Math.min(m - 1, Math.max(0, e));
        const i0 = Math.floor(e), i1 = Math.min(m - 1, i0 + 1), fr = e - i0;
        const ut: number[] = [];
        for (let j = 0; j < nOut; j++) {
          const a = les(i0 * nOut + j) / maks, b = les(i1 * nOut + j) / maks;
          const s = a + (b - a) * fr;
          ut.push(dec[2 * j] + s * (dec[2 * j + 1] - dec[2 * j]));
        }
        return ut;
      };
    }
  } catch { /* ukjent funksjon */ }
  return null;
}

/**
 * Siste utvei nar tintTransform ikke lar seg tolke. Fargen blir ikke riktig,
 * men den blir egen, og da separeres logoen fortsatt i riktig antall lag.
 * Brukeren velger folie selv, sa lagdelingen er det viktige.
 */
function reserveFarge(navn: string, tint: number): [number, number, number] {
  if (tint <= 0.01) return [1, 1, 1];
  let h = 0;
  for (let i = 0; i < navn.length; i++) h = (h * 31 + navn.charCodeAt(i)) >>> 0;
  const seks = (h % 360) / 60;
  const c = 0.7 * tint, x = c * (1 - Math.abs((seks % 2) - 1)), m = 0.15;
  const bord: [number, number, number][] =
    [[c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x]];
  const [r, g, b] = bord[Math.floor(seks) % 6];
  return [r + m, g + m, b + m];
}

function csFraObj(ctx: any, obj: any): CsKind {
  if (!obj) return null;
  const opp = (x: any) => (ctx?.lookup ? ctx.lookup(x) ?? x : x);
  try {
    if (obj instanceof PDFName) {
      const nv = String(obj).slice(1);
      return nv === "DeviceCMYK" ? CS_CMYK
           : nv === "DeviceRGB" ? CS_RGB
           : nv === "DeviceGray" ? CS_GRAY : null;
    }
    const arr = obj.asArray ? obj.asArray() : null;
    if (!arr || !arr.length) return null;
    const fam = String(opp(arr[0])).slice(1);

    if (fam === "ICCBased") {
      const st: any = opp(arr[1]);
      const n = st?.dict?.lookup(PDFName.of("N"))?.asNumber?.() ?? 3;
      return n === 1 ? CS_GRAY : n === 4 ? CS_CMYK : CS_RGB;
    }
    if (fam === "CalRGB") return CS_RGB;
    if (fam === "CalGray") return CS_GRAY;
    if (fam === "DeviceCMYK") return CS_CMYK;
    if (fam === "DeviceRGB") return CS_RGB;
    if (fam === "DeviceGray") return CS_GRAY;
    if (fam === "Lab") {
      const d: any = opp(arr[1]);
      const wp = tallArr(d?.lookup?.(PDFName.of("WhitePoint"))) ?? undefined;
      return { n: 3, tilRgb: (v) => labTilRgb(v[0], v[1], v[2], wp) };
    }
    if (fam === "Separation" || fam === "DeviceN") {
      const navnObj: any = opp(arr[1]);
      const antall = fam === "Separation"
        ? 1 : (navnObj?.asArray ? navnObj.asArray().length : 1);
      const navnStr = fam === "Separation"
        ? String(navnObj)
        : (navnObj?.asArray ? navnObj.asArray().map(String).join(",") : "DeviceN");
      const alt = csFraObj(ctx, opp(arr[2]));
      const fn = lagFn(ctx, opp(arr[3]));
      return {
        n: antall,
        tilRgb: (v) => {
          const tint = v.slice(-antall);
          if (alt && fn) {
            const ut = fn(tint);
            if (ut && ut.length >= alt.n) {
              const r = alt.tilRgb(ut.slice(0, alt.n));
              if (r) return r;
            }
          }
          return reserveFarge(navnStr, tint[tint.length - 1] ?? 1);
        },
      };
    }
  } catch { /* ukjent fargerom */ }
  return null;
}

function csType(res: PDFDict | undefined, navn: string): CsKind {
  if (navn === "DeviceCMYK") return CS_CMYK;
  if (navn === "DeviceRGB") return CS_RGB;
  if (navn === "DeviceGray") return CS_GRAY;
  const csres = res?.lookup(PDFName.of("ColorSpace"), PDFDict);
  const obj: any = csres?.lookup(PDFName.of(navn));
  if (!obj) return null;
  return csFraObj((csres as any)?.context ?? (obj as any)?.context, obj);
}

/** Fargen som rgb 0..1, sa fargeseparering vet hva som er hva. */
function rgbScn(cs: CsKind, tall: number[]): [number, number, number] | null {
  if (!cs || !tall.length) return null;
  const v = tall.slice(-cs.n);
  if (v.length < cs.n) return null;
  return cs.tilRgb(v);
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

function hvitScn(cs: CsKind, tall: number[]): boolean | null {
  const rgb = rgbScn(cs, tall);
  if (!rgb) return null;
  return rgb.every((v) => v >= 0.99);
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

/**
 * Lukker smale glipper i en flate: blaser den ut og krymper den tilbake.
 * Brukes til a finne ut om en farge over ligger i et spor i fargen under,
 * og ikke bare ved siden av den. Miter holder hjornene skarpe, sa formen
 * kommer tilbake som den var utenom glippene.
 */
export function lukkGlipper(mp: MultiPoly, delta: number): MultiPoly {
  if (!(delta > 0) || !mp.length) return mp;
  const S = 1e4;
  const tilC = (m: MultiPoly) => m.flatMap((p) =>
    p.map((r) => r.map(([x, y]) => ({ X: Math.round(x * S), Y: Math.round(y * S) }))));
  const kjor = (baner: any[], d: number) => {
    const co = new ClipperLib.ClipperOffset(2, 0.25);
    co.AddPaths(baner, ClipperLib.JoinType.jtMiter, ClipperLib.EndType.etClosedPolygon);
    const ut: any[] = [];
    co.Execute(ut, d * S);
    return ut;
  };
  const ut = kjor(kjor(tilC(mp), delta), -delta);
  if (!ut.length) return mp;
  const ringer: Ring[] = ut
    .map((p: any[]) => p.map((q: any) => [q.X / S, q.Y / S] as [number, number]))
    .filter((r: Ring) => r.length > 2)
    .map(lukkRing);
  return ringer.length ? nestRinger(ringer) : mp;
}
