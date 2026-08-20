/**
 * Trekker dekoren ut av en bilskisse og skriver den som en ren PDF.
 *
 * Banene beholdes som baner. En affin transform tar vare paa bezierkurver,
 * sa kontrollpunktene kan regnes om og skrives ut igjen uten a flates.
 * Resultatet er en fil motoren kan behandle som en hvilken som helst logo.
 */
import { PDFDocument, PDFName, PDFDict, PDFRawStream, decodePDFRawStream, PDFOperator } from "pdf-lib";

type Mat = [number, number, number, number, number, number];
const ID: Mat = [1, 0, 0, 1, 0, 0];

type Seg =
  | { t: "m"; p: [number, number] }
  | { t: "l"; p: [number, number] }
  | { t: "c"; a: [number, number]; b: [number, number]; c: [number, number] }
  | { t: "h" };

export interface Bane {
  segs: Seg[];
  farge: number[];
  strekFarge: number[];
  fyll: boolean;
  strek: boolean;
  bredde: number;
  boks: { x0: number; y0: number; x1: number; y1: number };
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
    if (obj instanceof PDFRawStream) return new TextDecoder("latin1").decode(decodePDFRawStream(obj).decode());
    if (obj?.getContents) return new TextDecoder("latin1").decode(obj.getContents());
  } catch { /* uleselig */ }
  return "";
}

const TOKEN = /\/[^\s/[\]<>(){}]+|\((?:[^()\\]|\\.)*\)|<<|>>|\[|\]|[^\s[\]<>(){}/]+/g;
const FYLL = new Set(["f", "F", "f*", "b", "b*", "B", "B*"]);
const STREK = new Set(["S", "s", "b", "b*", "B", "B*"]);

function gaa(data: string, res: PDFDict | undefined, ctm: Mat, dybde: number, ut: Bane[]) {
  const mStabel: Mat[] = [], fStabel: number[][] = [], wStabel: number[] = [];
  const sStabel: number[][] = [];
  let cur = ctm, tall: number[] = [], navn: string | null = null;
  // Fyll og strek har hver sin farge i PDF. Sma bokstaver setter fyllet,
  // store setter streken. Uten begge blir konturen pa bilen usynlig, for
  // karosseriet er fylt hvitt og streket sort.
  let farge: number[] = [0, 0, 0, 1], strekFarge: number[] = [0, 0, 0, 1], bredde = 1;
  let segs: Seg[] = [];
  let boks = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  const se = (p: [number, number]) => {
    if (p[0] < boks.x0) boks.x0 = p[0]; if (p[0] > boks.x1) boks.x1 = p[0];
    if (p[1] < boks.y0) boks.y0 = p[1]; if (p[1] > boks.y1) boks.y1 = p[1];
    return p;
  };
  const tom = () => { segs = []; boks = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity }; };

  for (const t of data.match(TOKEN) ?? []) {
    const n = Number(t);
    if (!Number.isNaN(n) && t !== "") { tall.push(n); continue; }
    if (t.startsWith("/")) { navn = t.slice(1); continue; }
    if (t.startsWith("(")) continue;
    const op = t;

    if (op === "q") { mStabel.push(cur); fStabel.push(farge); sStabel.push(strekFarge); wStabel.push(bredde); }
    else if (op === "Q") {
      cur = mStabel.pop() ?? cur; farge = fStabel.pop() ?? farge;
      strekFarge = sStabel.pop() ?? strekFarge; bredde = wStabel.pop() ?? bredde;
    }
    else if (op === "cm" && tall.length >= 6) cur = mul(tall.slice(-6) as Mat, cur);
    else if (op === "w" && tall.length >= 1) bredde = tall[tall.length - 1];
    else if (op === "k" && tall.length >= 4) farge = tall.slice(-4);
    else if (op === "g" && tall.length >= 1) farge = [0, 0, 0, 1 - tall[tall.length - 1]];
    else if (op === "rg" && tall.length >= 3) {
      const v = tall.slice(-3); const kk = 1 - Math.max(v[0], v[1], v[2]);
      farge = kk >= 1 ? [0, 0, 0, 1] : [(1 - v[0] - kk) / (1 - kk), (1 - v[1] - kk) / (1 - kk), (1 - v[2] - kk) / (1 - kk), kk];
    }
    else if (op === "K" && tall.length >= 4) strekFarge = tall.slice(-4);
    else if (op === "G" && tall.length >= 1) strekFarge = [0, 0, 0, 1 - tall[tall.length - 1]];
    else if (op === "RG" && tall.length >= 3) {
      const v = tall.slice(-3); const kk = 1 - Math.max(v[0], v[1], v[2]);
      strekFarge = kk >= 1 ? [0, 0, 0, 1] : [(1 - v[0] - kk) / (1 - kk), (1 - v[1] - kk) / (1 - kk), (1 - v[2] - kk) / (1 - kk), kk];
    }
    else if (op === "m" && tall.length >= 2) segs.push({ t: "m", p: se(app(cur, tall[tall.length - 2], tall[tall.length - 1])) });
    else if (op === "l" && tall.length >= 2) segs.push({ t: "l", p: se(app(cur, tall[tall.length - 2], tall[tall.length - 1])) });
    else if (op === "c" && tall.length >= 6) {
      const v = tall.slice(-6);
      segs.push({ t: "c", a: se(app(cur, v[0], v[1])), b: se(app(cur, v[2], v[3])), c: se(app(cur, v[4], v[5])) });
    } else if (op === "v" && tall.length >= 4) {
      const v = tall.slice(-4);
      const forrige = [...segs].reverse().find((s) => s.t !== "h") as any;
      const p0 = forrige ? (forrige.p ?? forrige.c) : [0, 0];
      segs.push({ t: "c", a: p0 as any, b: se(app(cur, v[0], v[1])), c: se(app(cur, v[2], v[3])) });
    } else if (op === "y" && tall.length >= 4) {
      const v = tall.slice(-4);
      const a = se(app(cur, v[0], v[1])), c = se(app(cur, v[2], v[3]));
      segs.push({ t: "c", a, b: c, c });
    } else if (op === "re" && tall.length >= 4) {
      const [x, y, w, h] = tall.slice(-4);
      segs.push({ t: "m", p: se(app(cur, x, y)) });
      segs.push({ t: "l", p: se(app(cur, x + w, y)) });
      segs.push({ t: "l", p: se(app(cur, x + w, y + h)) });
      segs.push({ t: "l", p: se(app(cur, x, y + h)) });
      segs.push({ t: "h" });
    } else if (op === "h") segs.push({ t: "h" });
    else if (FYLL.has(op) || STREK.has(op) || op === "n") {
      if (segs.length && op !== "n") {
        const sk = Math.sqrt(Math.abs(cur[0] * cur[3] - cur[1] * cur[2])) || 1;
        ut.push({ segs, farge: farge.slice(), strekFarge: strekFarge.slice(),
          fyll: FYLL.has(op), strek: STREK.has(op), bredde: bredde * sk, boks });
      }
      tom();
    } else if (op === "W" || op === "W*") { /* klipp: banen males ikke */ }
    else if (op === "Do" && navn && dybde < 6) {
      const xo = res?.lookup(PDFName.of("XObject"), PDFDict);
      const form: any = xo?.lookup(PDFName.of(navn));
      const dict: PDFDict | undefined = form?.dict ?? form;
      if (dict && String(dict.lookup(PDFName.of("Subtype"))) === "/Form") {
        const mArr: any = dict.lookup(PDFName.of("Matrix"));
        const fm: Mat = mArr?.asArray ? (mArr.asArray().map((v: any) => v.asNumber()) as Mat) : ID;
        gaa(streamText(form), dict.lookup(PDFName.of("Resources"), PDFDict) ?? res, mul(fm, cur), dybde + 1, ut);
      }
    }
    if (op !== "cs" && op !== "CS") tall = [];
  }
}

export async function hentBaner(pdf: Uint8Array): Promise<{ baner: Bane[]; side: number[] }> {
  const doc = await PDFDocument.load(pdf, { ignoreEncryption: true });
  const page: any = doc.getPage(0);
  const c: any = page.node.Contents();
  let data = "";
  if (c?.asArray) for (const r of c.asArray()) data += streamText(doc.context.lookup(r)) + "\n";
  else data = streamText(c);
  const baner: Bane[] = [];
  gaa(data, page.node.Resources(), ID, 0, baner);
  const mb: any = page.node.MediaBox();
  const v = mb?.asArray ? mb.asArray().map((x: any) => x.asNumber()) : [0, 0, 595, 842];
  return { baner, side: v };
}

const nr = (v: number) => (Math.round(v * 1000) / 1000).toString();

/** Skriver de valgte banene til en ny PDF, flyttet til origo. */
export async function skrivPdf(baner: Bane[], marg = 6): Promise<Uint8Array> {
  const x0 = Math.min(...baner.map((b) => b.boks.x0)) - marg;
  const y0 = Math.min(...baner.map((b) => b.boks.y0)) - marg;
  const x1 = Math.max(...baner.map((b) => b.boks.x1)) + marg;
  const y1 = Math.max(...baner.map((b) => b.boks.y1)) + marg;

  const linjer: string[] = [];
  let sisteFyll = "", sisteStrek = "";
  for (const b of baner) {
    const f = `${nr(b.farge[0])} ${nr(b.farge[1])} ${nr(b.farge[2])} ${nr(b.farge[3])}`;
    const sf = b.strekFarge
      ? `${nr(b.strekFarge[0])} ${nr(b.strekFarge[1])} ${nr(b.strekFarge[2])} ${nr(b.strekFarge[3])}` : f;
    if (f !== sisteFyll) { linjer.push(`${f} k`); sisteFyll = f; }
    if (sf !== sisteStrek) { linjer.push(`${sf} K`); sisteStrek = sf; }
    if (b.strek) linjer.push(`${nr(b.bredde)} w`);
    for (const s of b.segs) {
      if (s.t === "m") linjer.push(`${nr(s.p[0] - x0)} ${nr(s.p[1] - y0)} m`);
      else if (s.t === "l") linjer.push(`${nr(s.p[0] - x0)} ${nr(s.p[1] - y0)} l`);
      else if (s.t === "c") linjer.push(`${nr(s.a[0] - x0)} ${nr(s.a[1] - y0)} ${nr(s.b[0] - x0)} ${nr(s.b[1] - y0)} ${nr(s.c[0] - x0)} ${nr(s.c[1] - y0)} c`);
      else linjer.push("h");
    }
    linjer.push(b.fyll && b.strek ? "B" : b.fyll ? "f" : "S");
  }

  const doc = await PDFDocument.create();
  const side = doc.addPage([x1 - x0, y1 - y0]);
  // pushOperators({ toString }) gjor ingenting. pdf-lib serialiserer via
  // copyBytesInto, sa raa operatorer maa inn gjennom PDFOperator.of.
  (side as any).pushOperators(...linjer.map((l) => PDFOperator.of(l as any)));
  return doc.save();
}
