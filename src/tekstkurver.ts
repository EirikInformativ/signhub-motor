/**
 * Levende tekst i en bilskisse gjoeres om til kurver.
 *
 * Motoren leser bare baner. Tekst som designeren ikke har konvertert til
 * kurver (BT ... Tj/TJ ... ET) kom derfor ikke med i skjaerefilene: paa
 * 309916 e-expert manglet «XL-BYGG Osteroy» paa to av tre steder. Er
 * fonten innebygd i PDF-en, tegner vi glyfene selv og skriver dem inn i
 * innholdsstroemmen der teksten sto, som vanlige fylte baner i samme
 * grafikktilstand. Fyllfarge, spotfarge, klippebane og CTM foelger da med
 * av seg selv, og lesLett, hentBaner og resten av motoren ser teksten
 * akkurat som om designeren hadde konvertert den.
 *
 * Hver tekstvisning (Tj, TJ, ' og ") som skal konverteres byttes ut med
 *
 *     ET <baner> f BT <linjematrisen> Tm [<fremdrift>] TJ
 *
 * Tekstobjektet avsluttes foer banene (baner er ikke lov inne i BT/ET), og
 * aapnes igjen med tekstmatrisen satt tilbake, saa resten av teksten i
 * samme objekt staar der den sto. Tekstmatrisen er alltid linjematrisen
 * forskjoevet langs grunnlinjen, saa en tom TJ med riktig justering gir
 * den tilbake noeyaktig.
 *
 * Usynlig tekst (Tr 3 og 7) og tekst som klipper (Tr 4 til 7) gjoeres ikke
 * om. Tekst i en font som ikke er innebygd, eller som ikke lar seg lese,
 * staar igjen som levende tekst og meldes som foer. Ingenting forsvinner i
 * stillhet.
 */
import { PDFDocument, PDFName, PDFDict, PDFArray, PDFRawStream, PDFRef, PDFNumber, PDFStream, decodePDFRawStream } from "pdf-lib";
import { csFraObj, rgbScn } from "./pdfbaner.ts";
import type { Cs } from "./pdfbaner.ts";
import { lesFontfil } from "./fontglyf.ts";
import type { GlyfFont, GSeg } from "./fontglyf.ts";
import { STANDARD_ENC, WINANSI_ENC, MACROMAN_ENC } from "./fontdata.ts";

type Mat = [number, number, number, number, number, number];
const ID: Mat = [1, 0, 0, 1, 0, 0];
const mul = (a: Mat, b: Mat): Mat => [
  a[0] * b[0] + a[1] * b[2], a[0] * b[1] + a[1] * b[3],
  a[2] * b[0] + a[3] * b[2], a[2] * b[1] + a[3] * b[3],
  a[4] * b[0] + a[5] * b[2] + b[4], a[4] * b[1] + a[5] * b[3] + b[5],
];
const app = (m: Mat, x: number, y: number): [number, number] => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

/** rgb 0..1 til samme cmyk-form som lesLett bruker */
const rgbTilCmyk = (v: number[]): number[] => {
  const kk = 1 - Math.max(v[0], v[1], v[2]);
  return kk >= 1 ? [0, 0, 0, 1] : [(1 - v[0] - kk) / (1 - kk), (1 - v[1] - kk) / (1 - kk), (1 - v[2] - kk) / (1 - kk), kk];
};

/** En tekstvisning paa arket, i sidekoordinater */
export interface TekstVisning {
  id: string;
  tekst: string;
  x0: number; y0: number; x1: number; y1: number;
  /** fyllfargen som cmyk, samme form som lesLett */
  farge: number[];
  usynlig: boolean;
  /** kan gjoeres om til kurver (fonten er innebygd og lesbar, teksten tegnes) */
  kan: boolean;
  /** hvorfor ikke, naar kan er false */
  grunn?: string;
}

/* ---------- leksikalsk analyse som tar vare paa posisjonene ---------- */

type Tok = { t: "tall"; v: number; s: number; e: number }
  | { t: "navn"; v: string; s: number; e: number }
  | { t: "str"; v: number[]; s: number; e: number }
  | { t: "arr"; v: Tok[]; s: number; e: number }
  | { t: "op"; v: string; s: number; e: number }
  | { t: "annet"; s: number; e: number };

const HVIT = (c: number) => c === 32 || c === 10 || c === 13 || c === 9 || c === 12 || c === 0;
const SKILLE = (c: number) => HVIT(c) || c === 40 || c === 41 || c === 60 || c === 62 || c === 91 || c === 93 || c === 123 || c === 125 || c === 47 || c === 37;

function* tokens(s: string): Generator<Tok> {
  let i = 0;
  const n = s.length;
  const lesEn = (): Tok | null => {
    while (i < n) {
      const c = s.charCodeAt(i);
      if (HVIT(c)) { i++; continue; }
      if (c === 37) { while (i < n && s[i] !== "\n" && s[i] !== "\r") i++; continue; }
      break;
    }
    if (i >= n) return null;
    const st = i;
    const c = s.charCodeAt(i);
    if (c === 40) { // (streng)
      const b: number[] = [];
      let dybde = 1; i++;
      while (i < n && dybde > 0) {
        const ch = s.charCodeAt(i);
        if (ch === 92) {
          const nx = s[i + 1];
          if (nx === undefined) { i++; break; }
          if (/[0-7]/.test(nx)) {
            let o = ""; let k = i + 1;
            while (k < n && o.length < 3 && /[0-7]/.test(s[k])) o += s[k++];
            b.push(parseInt(o, 8) & 255); i = k; continue;
          }
          const m: Record<string, number> = { n: 10, r: 13, t: 9, b: 8, f: 12 };
          if (nx === "\r") { i += s[i + 2] === "\n" ? 3 : 2; continue; }
          if (nx === "\n") { i += 2; continue; }
          b.push(m[nx] ?? nx.charCodeAt(0)); i += 2; continue;
        }
        if (ch === 40) dybde++;
        if (ch === 41) { dybde--; if (dybde === 0) { i++; break; } }
        b.push(ch & 255); i++;
      }
      return { t: "str", v: b, s: st, e: i };
    }
    if (c === 60 && s[i + 1] === "<") { i += 2; return { t: "annet", s: st, e: i }; }
    if (c === 62 && s[i + 1] === ">") { i += 2; return { t: "annet", s: st, e: i }; }
    if (c === 60) { // <hex>
      let h = ""; i++;
      while (i < n && s[i] !== ">") { if (/[0-9a-fA-F]/.test(s[i])) h += s[i]; i++; }
      i++;
      if (h.length % 2) h += "0";
      const b: number[] = [];
      for (let k = 0; k < h.length; k += 2) b.push(parseInt(h.slice(k, k + 2), 16));
      return { t: "str", v: b, s: st, e: i };
    }
    if (c === 91) { // [ ... ]
      i++;
      const v: Tok[] = [];
      for (;;) {
        while (i < n && HVIT(s.charCodeAt(i))) i++;
        if (i >= n) break;
        if (s[i] === "]") { i++; break; }
        const t = lesEn();
        if (!t) break;
        v.push(t);
      }
      return { t: "arr", v, s: st, e: i };
    }
    if (c === 93 || c === 123 || c === 125 || c === 41 || c === 62) { i++; return { t: "annet", s: st, e: i }; }
    if (c === 47) {
      i++;
      while (i < n && !SKILLE(s.charCodeAt(i))) i++;
      return { t: "navn", v: s.slice(st + 1, i).replace(/#([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16))), s: st, e: i };
    }
    while (i < n && !SKILLE(s.charCodeAt(i))) i++;
    if (i === st) { i++; return { t: "annet", s: st, e: i }; }
    const w = s.slice(st, i);
    const tall = Number(w);
    if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(w) && !Number.isNaN(tall)) return { t: "tall", v: tall, s: st, e: i };
    return { t: "op", v: w, s: st, e: i };
  };
  for (;;) {
    const t = lesEn();
    if (!t) return;
    // innebygd bilde: hopp over data mellom ID og EI
    if (t.t === "op" && t.v === "ID") {
      i++;
      const m = /\sEI(?=[\s]|$)/g;
      m.lastIndex = i;
      const r = m.exec(s);
      const slutt = r ? r.index + r[0].length : n;
      yield t;
      yield { t: "annet", s: i, e: slutt };
      i = slutt;
      continue;
    }
    yield t;
  }
}

/* ---------- fonter ---------- */

interface PdfFont {
  /** bytes til koder (1 byte for enkle fonter, 2 for Identity-H) */
  koder(b: number[]): number[];
  gid(kode: number): number | undefined;
  bredde(kode: number): number;
  glyf: GlyfFont;
  unicode(kode: number): string;
}

/** glyfnavn til unicode for navnene i tabellene vi har (WinAnsi = cp1252) */
const NAVN_UNI = (() => {
  const m = new Map<string, string>();
  const cp = new TextDecoder("windows-1252");
  WINANSI_ENC.forEach((nm, c) => { if (nm && !m.has(nm)) m.set(nm, cp.decode(new Uint8Array([c]))); });
  m.set("space", " ");
  return m;
})();
const navnTilUni = (nm: string): string | undefined => {
  const u = NAVN_UNI.get(nm);
  if (u) return u;
  const m = nm.match(/^uni([0-9A-Fa-f]{4})/) ?? nm.match(/^u([0-9A-Fa-f]{4,6})$/);
  return m ? String.fromCodePoint(parseInt(m[1], 16)) : undefined;
};

function strmBytes(o: any): Uint8Array {
  if (o instanceof PDFRawStream) return decodePDFRawStream(o).decode();
  if (o?.getContents) return o.getContents();
  throw new Error("ikke en stroem");
}

function tallListe(a: any): number[] {
  return a?.asArray ? a.asArray().map((x: any) => (x instanceof PDFNumber ? x.asNumber() : Number(x?.asNumber?.() ?? 0))) : [];
}

function lesPdfFont(dict: PDFDict): PdfFont {
  const sub = String(dict.lookup(PDFName.of("Subtype")));
  if (sub === "/Type0") return lesType0(dict);
  if (sub !== "/Type1" && sub !== "/TrueType" && sub !== "/MMType1") throw new Error(`fonttypen ${sub} stoettes ikke`);
  const fd = dict.lookup(PDFName.of("FontDescriptor"), PDFDict);
  if (!fd) throw new Error("fonten er ikke innebygd (mangler FontDescriptor)");
  let glyf: GlyfFont;
  const ff3 = fd.lookup(PDFName.of("FontFile3"));
  const ff2 = fd.lookup(PDFName.of("FontFile2"));
  if (ff3) {
    const st = String((ff3 as any).dict?.lookup(PDFName.of("Subtype")));
    glyf = lesFontfil(strmBytes(ff3), st === "/OpenType" ? "otf" : "cff");
  } else if (ff2) glyf = lesFontfil(strmBytes(ff2), "ttf");
  else if (fd.lookup(PDFName.of("FontFile"))) throw new Error("Type 1-fonter (FontFile) stoettes ikke");
  else throw new Error("fonten er ikke innebygd");

  const flagg = (fd.lookup(PDFName.of("Flags")) as any)?.asNumber?.() ?? 0;
  const symbolsk = (flagg & 4) !== 0;
  const tt = sub === "/TrueType" || !!glyf.cmap?.length && !ff3;

  // koding: kode til glyfnavn
  const navn: (string | undefined)[] = new Array(256);
  let harKoding = false;
  const enc = dict.lookup(PDFName.of("Encoding"));
  const tab = (n: string) => n === "/WinAnsiEncoding" ? WINANSI_ENC : n === "/MacRomanEncoding" ? MACROMAN_ENC
    : n === "/StandardEncoding" ? STANDARD_ENC : null;
  const legg = (t: string[] | null) => { if (t) { harKoding = true; for (let c = 0; c < 256; c++) navn[c] = t[c] || undefined; } };
  if (enc instanceof PDFName) legg(tab(enc.toString()));
  else if (enc instanceof PDFDict) {
    const be = enc.lookup(PDFName.of("BaseEncoding"));
    if (be instanceof PDFName) legg(tab(be.toString()));
    else if (!symbolsk && !ff3 && tt) legg(STANDARD_ENC);
    const diff = enc.lookup(PDFName.of("Differences"), PDFArray);
    if (diff) {
      harKoding = true;
      let c = 0;
      for (const v of diff.asArray()) {
        if (v instanceof PDFNumber) c = v.asNumber();
        else if (v instanceof PDFName) { navn[c & 255] = v.toString().slice(1); c++; }
      }
    }
  }

  const gidAv = (kode: number): number | undefined => {
    const nm = navn[kode];
    if (glyf.cmap?.length && sub === "/TrueType") {
      const finn = (p: number, e: number) => glyf.cmap!.find((c) => c.p === p && c.e === e);
      const c31 = finn(3, 1), c30 = finn(3, 0), c10 = finn(1, 0);
      if (nm) {
        const g0 = glyf.navnTilGid(nm);
        const u = navnTilUni(nm);
        if (c31 && u) { const g = c31.slaa(u.codePointAt(0)!); if (g) return g; }
        if (c10) { const mk = MACROMAN_ENC.indexOf(nm); if (mk >= 0) { const g = c10.slaa(mk); if (g) return g; } }
        if (g0) return g0;
      }
      if (c30) { const g = c30.slaa(0xf000 + kode) || c30.slaa(kode); if (g) return g; }
      if (c10) { const g = c10.slaa(kode); if (g) return g; }
      if (c31) { const g = c31.slaa(kode); if (g) return g; }
      return undefined;
    }
    if (nm) { const g = glyf.navnTilGid(nm); if (g !== undefined) return g; }
    const eg = glyf.egenKoding(kode);
    if (eg !== undefined) return eg;
    if (!harKoding) { const sn = STANDARD_ENC[kode]; const g = sn ? glyf.navnTilGid(sn) : undefined; if (g !== undefined) return g; }
    return undefined;
  };

  const first = (dict.lookup(PDFName.of("FirstChar")) as any)?.asNumber?.() ?? 0;
  const bredder = tallListe(dict.lookup(PDFName.of("Widths")));
  const mangler = (fd.lookup(PDFName.of("MissingWidth")) as any)?.asNumber?.();
  return {
    koder: (b) => b,
    gid: gidAv,
    bredde: (kode) => {
      const i = kode - first;
      if (i >= 0 && i < bredder.length) return bredder[i];
      if (mangler !== undefined) return mangler;
      const g = gidAv(kode);
      const f = g !== undefined ? glyf.fremdrift?.(g) : undefined;
      return f !== undefined ? f * glyf.matrise[0] * 1000 : 0;
    },
    glyf,
    unicode: (kode) => { const nm = navn[kode]; return (nm && navnTilUni(nm)) ?? String.fromCharCode(kode); },
  };
}

function lesType0(dict: PDFDict): PdfFont {
  const enc = dict.lookup(PDFName.of("Encoding"));
  if (!(enc instanceof PDFName) || enc.toString() !== "/Identity-H") throw new Error("Type0-font med annen koding enn Identity-H stoettes ikke");
  const desc = dict.lookup(PDFName.of("DescendantFonts"), PDFArray)?.lookup(0, PDFDict);
  if (!desc) throw new Error("Type0-font uten DescendantFonts");
  const sub = String(desc.lookup(PDFName.of("Subtype")));
  const fd = desc.lookup(PDFName.of("FontDescriptor"), PDFDict);
  if (!fd) throw new Error("fonten er ikke innebygd");
  const ff3 = fd.lookup(PDFName.of("FontFile3")), ff2 = fd.lookup(PDFName.of("FontFile2"));
  let glyf: GlyfFont;
  if (ff3) {
    const st = String((ff3 as any).dict?.lookup(PDFName.of("Subtype")));
    glyf = lesFontfil(strmBytes(ff3), st === "/OpenType" ? "otf" : "cff");
  } else if (ff2) glyf = lesFontfil(strmBytes(ff2), "ttf");
  else throw new Error("fonten er ikke innebygd");
  let cidGid: (c: number) => number | undefined = (c) => c;
  if (sub === "/CIDFontType2") {
    const m = desc.lookup(PDFName.of("CIDToGIDMap"));
    if (m && !(m instanceof PDFName)) {
      const b = strmBytes(m);
      cidGid = (c) => (2 * c + 1 < b.length ? (b[2 * c] << 8) | b[2 * c + 1] : undefined);
    }
  } else if (glyf.cidTilGid) cidGid = glyf.cidTilGid;
  const dw = (desc.lookup(PDFName.of("DW")) as any)?.asNumber?.() ?? 1000;
  const w = new Map<number, number>();
  const wa = desc.lookup(PDFName.of("W"), PDFArray)?.asArray() ?? [];
  for (let i = 0; i < wa.length;) {
    const a = (desc.context.lookup(wa[i]) as any)?.asNumber?.();
    const nx: any = desc.context.lookup(wa[i + 1]);
    if (nx instanceof PDFArray) { tallListe(nx).forEach((v, k) => w.set(a + k, v)); i += 2; }
    else { const b = nx?.asNumber?.(), v = (desc.context.lookup(wa[i + 2]) as any)?.asNumber?.(); for (let c = a; c <= b; c++) w.set(c, v); i += 3; }
  }
  // ToUnicode for teksten i meldingene (bfchar og bfrange, enkle tilfeller)
  const uni = new Map<number, string>();
  try {
    const tu = dict.lookup(PDFName.of("ToUnicode"));
    if (tu) {
      const s = new TextDecoder("latin1").decode(strmBytes(tu));
      const hx = (h: string) => { let u = ""; for (let k = 0; k + 3 < h.length; k += 4) u += String.fromCharCode(parseInt(h.slice(k, k + 4), 16)); return u; };
      for (const b of s.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) for (const m of b[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g)) uni.set(parseInt(m[1], 16), hx(m[2]));
      for (const b of s.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) for (const m of b[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g)) {
        const a = parseInt(m[1], 16), e = parseInt(m[2], 16), u = parseInt(m[3], 16);
        for (let c = a; c <= e && c - a < 65536; c++) uni.set(c, String.fromCharCode(u + c - a));
      }
    }
  } catch { /* uten unicode */ }
  return {
    koder: (b) => { const k: number[] = []; for (let i = 0; i + 1 < b.length; i += 2) k.push((b[i] << 8) | b[i + 1]); return k; },
    gid: cidGid,
    bredde: (c) => w.get(c) ?? dw,
    glyf,
    unicode: (c) => uni.get(c) ?? "?",
  };
}

/* ---------- gjennomgang av innholdet ---------- */

interface Tilstand {
  ctm: Mat; farge: number[]; fyllCs: Cs | null;
  font: string | null; fs: number; tc: number; tw: number; tz: number; tl: number; ts: number; tr: number;
}

interface Kontekst {
  doc: PDFDocument;
  fonter: Map<string, PdfFont | Error>;
  /** null: bare finn. Ellers id-ene som skal gjoeres om */
  velg: Set<string> | null;
  funnet: TekstVisning[];
  /** nye stroemmer for Form XObjects som er skrevet om */
  nyeForm: Map<string, { ref: PDFRef; data: string }>;
  ferdigForm: Set<string>;
}

const nr = (v: number) => {
  const r = Math.round(v * 10000) / 10000;
  return Object.is(r, -0) ? "0" : String(r);
};

function hentFont(k: Kontekst, res: PDFDict | undefined, navn: string): PdfFont | Error {
  const fd = res?.lookup(PDFName.of("Font"), PDFDict);
  const raa = fd?.get(PDFName.of(navn));
  const nokkel = raa instanceof PDFRef ? raa.toString() : `${navn}@${String(fd)}`.slice(0, 200);
  const c = k.fonter.get(nokkel);
  if (c) return c;
  let f: PdfFont | Error;
  try {
    const d = fd?.lookup(PDFName.of(navn), PDFDict);
    if (!d) throw new Error(`fant ikke fonten ${navn}`);
    f = lesPdfFont(d);
  } catch (e: any) {
    f = new Error(String(e?.message ?? e));
  }
  k.fonter.set(nokkel, f);
  return f;
}

/**
 * Gaar gjennom en innholdsstroem. Returnerer ny tekst for stroemmen hvis
 * noe er skrevet om, ellers null.
 */
function gaa(k: Kontekst, data: string, res: PDFDict | undefined, ctm0: Mat, noekkel: string, dybde: number): string | null {
  let g: Tilstand = { ctm: ctm0, farge: [0, 0, 0, 1], fyllCs: null, font: null, fs: 12, tc: 0, tw: 0, tz: 100, tl: 0, ts: 0, tr: 0 };
  const stabel: Tilstand[] = [];
  let tm: Mat = ID, tlm: Mat = ID;
  let ops: Tok[] = [];
  let teller = 0;
  const bytt: { s: number; e: number; ny: string }[] = [];
  let opStart = -1;

  for (const t of tokens(data)) {
    if (t.t !== "op") { if (opStart < 0) opStart = t.s; ops.push(t); continue; }
    const op = t.v;
    const start = opStart < 0 ? t.s : opStart;
    opStart = -1;
    const tall = ops.filter((o) => o.t === "tall").map((o) => (o as any).v as number);
    const sisteNavn = [...ops].reverse().find((o) => o.t === "navn") as any;
    switch (op) {
      case "q": stabel.push({ ...g }); break;
      case "Q": g = stabel.pop() ?? g; break;
      case "cm": if (tall.length >= 6) g.ctm = mul(tall.slice(-6) as Mat, g.ctm); break;
      case "k": if (tall.length >= 4) { g.farge = tall.slice(-4); g.fyllCs = null; } break;
      case "g": if (tall.length >= 1) { g.farge = [0, 0, 0, 1 - tall[tall.length - 1]]; g.fyllCs = null; } break;
      case "rg": if (tall.length >= 3) { g.farge = rgbTilCmyk(tall.slice(-3)); g.fyllCs = null; } break;
      case "cs": if (sisteNavn) g.fyllCs = csFraObj(res, sisteNavn.v); break;
      case "sc": case "scn": if (g.fyllCs) { const v = rgbScn(g.fyllCs, tall); if (v) g.farge = rgbTilCmyk(v); } break;
      case "BT": tm = ID; tlm = ID; break;
      case "Tf": if (sisteNavn) g.font = sisteNavn.v; if (tall.length) g.fs = tall[tall.length - 1]; break;
      case "Tc": if (tall.length) g.tc = tall[tall.length - 1]; break;
      case "Tw": if (tall.length) g.tw = tall[tall.length - 1]; break;
      case "Tz": if (tall.length) g.tz = tall[tall.length - 1]; break;
      case "TL": if (tall.length) g.tl = tall[tall.length - 1]; break;
      case "Ts": if (tall.length) g.ts = tall[tall.length - 1]; break;
      case "Tr": if (tall.length) g.tr = tall[tall.length - 1]; break;
      case "Tm": if (tall.length >= 6) { tm = tall.slice(-6) as Mat; tlm = tm; } break;
      case "Td": case "TD":
        if (tall.length >= 2) {
          const [tx, ty] = tall.slice(-2);
          if (op === "TD") g.tl = -ty;
          tlm = mul([1, 0, 0, 1, tx, ty], tlm); tm = tlm;
        }
        break;
      case "T*": tlm = mul([1, 0, 0, 1, 0, -g.tl], tlm); tm = tlm; break;
      case "Tj": case "TJ": case "'": case "\"": {
        let foran = "";
        if (op === "\"" && tall.length >= 2) { g.tw = tall[0]; g.tc = tall[1]; foran = `${nr(g.tw)} Tw ${nr(g.tc)} Tc `; }
        if (op === "'" || op === "\"") { tlm = mul([1, 0, 0, 1, 0, -g.tl], tlm); tm = tlm; }
        const arg = [...ops].reverse().find((o) => o.t === "str" || o.t === "arr");
        if (!arg) break;
        const deler: (number[] | number)[] = arg.t === "arr"
          ? arg.v.filter((o) => o.t === "str" || o.t === "tall").map((o) => (o.t === "str" ? o.v : (o as any).v))
          : [(arg as any).v];
        const id = `${noekkel}:${teller++}`;
        const font = g.font ? hentFont(k, res, g.font) : new Error("ingen font satt");
        const th = g.tz / 100;
        const usynlig = g.tr === 3 || g.tr === 7;
        const tm0 = tm;
        // tegn glyfene og flytt tekstmatrisen
        const segs: string[] = [];
        let tekst = "";
        let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
        const utvid = (m: Mat, x: number, y: number) => {
          const [px, py] = app(mul(m, g.ctm), x, y);
          if (px < bx0) bx0 = px; if (px > bx1) bx1 = px; if (py < by0) by0 = py; if (py > by1) by1 = py;
        };
        let grunn: string | undefined = font instanceof Error ? font.message : undefined;
        let dx = 0;
        for (const d of deler) {
          if (typeof d === "number") { dx += (-d / 1000) * g.fs * th; continue; }
          if (font instanceof Error) {
            // anslag: en halv skriftstoerrelse per tegn, nok til aa plassere teksten
            for (const c of d) { tekst += String.fromCharCode(c); const m = mul([1, 0, 0, 1, dx, 0], tm0); utvid(m, 0, -0.2 * g.fs); utvid(m, 0.5 * g.fs, 0.8 * g.fs); dx += (0.5 * g.fs + g.tc + (c === 32 ? g.tw : 0)) * th; }
            continue;
          }
          const koder = font.koder(d);
          for (const kode of koder) {
            tekst += font.unicode(kode);
            const m = mul(mul(font.glyf.matrise, [g.fs * th, 0, 0, g.fs, 0, g.ts]), mul([1, 0, 0, 1, dx, 0], tm0));
            const gid = font.gid(kode);
            const blank = /^\s*$/.test(font.unicode(kode)) || kode === 32;
            if (gid === undefined || gid === 0) { if (!blank && !grunn) grunn = `fant ikke glyfen for tegnkode ${kode}`; }
            else {
              let o: GSeg[] = [];
              try { o = font.glyf.omriss(gid); } catch (e: any) { if (!grunn) grunn = `glyfen kunne ikke leses: ${e?.message ?? e}`; }
              // én bane per glyf, som Illustrator gjoer ved «Create Outlines»
              const glyf: string[] = [];
              for (const s of o) {
                if (s.t === "h") { glyf.push("h"); continue; }
                const pts = s.t === "c" ? [s.a, s.b, s.c] : [s.p];
                const ut: string[] = [];
                for (const p of pts) { const [x, y] = app(m, p[0], p[1]); ut.push(nr(x), nr(y)); utvid(m, p[0], p[1]); }
                glyf.push(`${ut.join(" ")} ${s.t}`);
              }
              if (glyf.length) segs.push(glyf.join("\n"));
              // et synlig tegn uten omriss: fonten er ikke lest riktig, og teksten
              // ville forsvunnet i stillhet. Da staar den heller som levende tekst.
              else if (!blank && !grunn) grunn = `tegnet «${font.unicode(kode)}» har ikke noe omriss i fonten`;
            }
            const w0 = font.bredde(kode);
            const ord = koder.length === d.length && kode === 32;
            dx += ((w0 / 1000) * g.fs + g.tc + (ord ? g.tw : 0)) * th;
          }
        }
        tm = mul([1, 0, 0, 1, dx, 0], tm0);
        if (!Number.isFinite(bx0)) {
          const [px, py] = app(mul(tm0, g.ctm), 0, 0);
          bx0 = bx1 = px; by0 = by1 = py;
        }
        const klipper = g.tr >= 4;
        if (!grunn && klipper) grunn = "teksten brukes som klippebane";
        const kan = !grunn && !usynlig;
        k.funnet.push({ id, tekst, x0: bx0, y0: by0, x1: bx1, y1: by1, farge: g.farge.slice(), usynlig, kan,
          ...(grunn ? { grunn } : {}) });
        if (k.velg?.has(id) && kan) {
          // tm = forskyvning dxTot langs grunnlinjen fra tlm
          const inv = tilbake(tlm, tm);
          const just = g.fs * th ? (-inv * 1000) / (g.fs * th) : 0;
          const maling = g.tr === 1 ? "S" : g.tr === 2 ? "B" : "f";
          const baner = segs.length ? `ET\n${segs.map((x) => `${x}\n${maling}`).join("\n")}\nBT\n` : "";
          const ny = `${foran}${baner ? baner : ""}${tlm.map(nr).join(" ")} Tm\n${just ? `[${nr(just)}] TJ\n` : ""}`;
          bytt.push({ s: start, e: t.e, ny: baner ? ny : `${foran}${tlm.map(nr).join(" ")} Tm\n${just ? `[${nr(just)}] TJ\n` : ""}` });
        }
        break;
      }
      case "Do": {
        if (!sisteNavn || dybde >= 6) break;
        const xo = res?.lookup(PDFName.of("XObject"), PDFDict);
        const ref = xo?.get(PDFName.of(sisteNavn.v));
        const form: any = xo?.lookup(PDFName.of(sisteNavn.v));
        const dict: PDFDict | undefined = form?.dict ?? form;
        if (!dict || String(dict.lookup(PDFName.of("Subtype"))) !== "/Form") break;
        const fm: Mat = (() => { const a = tallListe(dict.lookup(PDFName.of("Matrix"))); return a.length === 6 ? (a as Mat) : ID; })();
        const fNokkel = ref instanceof PDFRef ? ref.toString() : `${noekkel}/${sisteNavn.v}`;
        let s = "";
        try { s = new TextDecoder("latin1").decode(strmBytes(form)); } catch { break; }
        const fres = dict.lookup(PDFName.of("Resources"), PDFDict) ?? res;
        const ny = gaa(k, s, fres, mul(fm, g.ctm), fNokkel, dybde + 1);
        if (ny !== null && ref instanceof PDFRef && !k.ferdigForm.has(fNokkel)) k.nyeForm.set(fNokkel, { ref, data: ny });
        k.ferdigForm.add(fNokkel);
        break;
      }
    }
    ops = [];
  }
  if (!bytt.length) return null;
  let ut = "", pos = 0;
  for (const b of bytt) { ut += data.slice(pos, b.s) + b.ny; pos = b.e; }
  return ut + data.slice(pos);
}

/** hvor langt tm er forskjoevet langs grunnlinjen fra tlm (i tekstrommet) */
function tilbake(tlm: Mat, tm: Mat): number {
  // tm = [1 0 0 1 d 0] x tlm  =>  tm.e - tlm.e = d * tlm.a, tm.f - tlm.f = d * tlm.b
  const a = tlm[0], b = tlm[1];
  const n2 = a * a + b * b;
  if (!n2) return 0;
  return ((tm[4] - tlm[4]) * a + (tm[5] - tlm[5]) * b) / n2;
}

function sideInnhold(doc: PDFDocument): { side: any; data: string } {
  const side: any = doc.getPage(0);
  const c: any = side.node.Contents();
  let data = "";
  const les = (o: any) => { try { return new TextDecoder("latin1").decode(strmBytes(o)); } catch { return ""; } };
  if (c?.asArray) for (const r of c.asArray()) data += les(doc.context.lookup(r)) + "\n";
  else if (c) data = les(c);
  return { side, data };
}

/** Finn alle tekstvisninger paa side 1, med plassering, farge og om de kan gjoeres om. */
export async function finnTekst(pdf: Uint8Array): Promise<TekstVisning[]> {
  const doc = await PDFDocument.load(pdf, { ignoreEncryption: true });
  const k: Kontekst = { doc, fonter: new Map(), velg: null, funnet: [], nyeForm: new Map(), ferdigForm: new Set() };
  const { side, data } = sideInnhold(doc);
  gaa(k, data, side.node.Resources(), ID, "side", 0);
  return k.funnet;
}

/**
 * Gjoer tekstvisningene med id i `velg` om til kurver. Gir ny PDF og
 * visningene som faktisk ble gjort om.
 */
export async function tekstTilKurver(pdf: Uint8Array, velg: Set<string>):
    Promise<{ pdf: Uint8Array; gjort: TekstVisning[] }> {
  const doc = await PDFDocument.load(pdf, { ignoreEncryption: true });
  const k: Kontekst = { doc, fonter: new Map(), velg, funnet: [], nyeForm: new Map(), ferdigForm: new Set() };
  const { side, data } = sideInnhold(doc);
  const ny = gaa(k, data, side.node.Resources(), ID, "side", 0);
  const gjort = k.funnet.filter((t) => t.kan && velg.has(t.id));
  if (ny === null && !k.nyeForm.size) return { pdf, gjort: [] };
  const latin = (s: string) => { const b = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 255; return b; };
  if (ny !== null) side.node.set(PDFName.of("Contents"), doc.context.register(doc.context.flateStream(latin(ny))));
  for (const { ref, data: fd } of k.nyeForm.values()) {
    const gammel = doc.context.lookup(ref) as PDFStream;
    const d = gammel.dict.clone(doc.context);
    for (const n of ["Length", "Filter", "DecodeParms"]) d.delete(PDFName.of(n));
    const strm = doc.context.flateStream(latin(fd));
    for (const [n, v] of d.entries()) strm.dict.set(n, v);
    doc.context.assign(ref, strm);
  }
  return { pdf: await doc.save(), gjort };
}
