/**
 * Lett lesing av en bilskisse.
 *
 * Skissen inneholder titusener av kurver i selve biltegningen. Motoren
 * trenger ikke dem. Den trenger malestokken, malene som staar i teksten,
 * og hvor visningene ligger pa arket. Derfor flates ingen kurver ut her:
 * kontrollpunktene rammer inn kurven, og en ramme er alt vi er ute etter.
 */
import { PDFDocument, PDFName, PDFDict, PDFRawStream, decodePDFRawStream } from "pdf-lib";

type Mat = [number, number, number, number, number, number];
const ID: Mat = [1, 0, 0, 1, 0, 0];
const MM = 72 / 25.4;

export interface Boks { x0: number; y0: number; x1: number; y1: number; farge?: number[] }
export interface LettLest { tekst: string; bokser: Boks[]; side: Boks }

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
  } catch { /* uleselig */ }
  return "";
}

const TOKEN = /\/[^\s/[\]<>(){}]+|\((?:[^()\\]|\\.)*\)|<<|>>|\[|\]|[^\s[\]<>(){}/]+/g;

function gaa(data: string, res: PDFDict | undefined, ctm: Mat, dybde: number,
             ut: Boks[], tekst: string[]) {
  const stabel: Mat[] = [];
  let cur = ctm;
  let tall: number[] = [];
  let navn: string | null = null;
  let boks: Boks | null = null;
  let farge: number[] = [0, 0, 0, 1];
  const fargeStabel: number[][] = [];

  const punkt = (x: number, y: number) => {
    const [px, py] = app(cur, x, y);
    if (!boks) boks = { x0: px, y0: py, x1: px, y1: py };
    else {
      if (px < boks.x0) boks.x0 = px; if (px > boks.x1) boks.x1 = px;
      if (py < boks.y0) boks.y0 = py; if (py > boks.y1) boks.y1 = py;
    }
  };
  const lukk = () => { if (boks) { boks.farge = farge.slice(); ut.push(boks); boks = null; } };

  for (const t of data.match(TOKEN) ?? []) {
    const n = Number(t);
    if (!Number.isNaN(n) && t !== "") { tall.push(n); continue; }
    if (t.startsWith("/")) { navn = t.slice(1); continue; }
    if (t.startsWith("(")) {
      tekst.push(t.slice(1, -1).replace(/\\([()\\])/g, "$1"));
      continue;
    }
    const op = t;
    if (op === "q") { stabel.push(cur); fargeStabel.push(farge); }
    else if (op === "Q") { cur = stabel.pop() ?? cur; farge = fargeStabel.pop() ?? farge; }
    else if (op === "k" && tall.length >= 4) farge = tall.slice(-4);
    else if (op === "g" && tall.length >= 1) farge = [0, 0, 0, 1 - tall[tall.length - 1]];
    else if (op === "rg" && tall.length >= 3) {
      const v = tall.slice(-3);
      const k = 1 - Math.max(v[0], v[1], v[2]);
      farge = k >= 1 ? [0, 0, 0, 1] : [(1 - v[0] - k) / (1 - k), (1 - v[1] - k) / (1 - k), (1 - v[2] - k) / (1 - k), k];
    }
    else if (op === "cm" && tall.length >= 6) cur = mul(tall.slice(-6) as Mat, cur);
    else if ((op === "m" || op === "l") && tall.length >= 2) punkt(tall[tall.length - 2], tall[tall.length - 1]);
    else if (op === "c" && tall.length >= 6) {
      const v = tall.slice(-6);
      punkt(v[0], v[1]); punkt(v[2], v[3]); punkt(v[4], v[5]);
    } else if ((op === "v" || op === "y") && tall.length >= 4) {
      const v = tall.slice(-4); punkt(v[0], v[1]); punkt(v[2], v[3]);
    } else if (op === "re" && tall.length >= 4) {
      const [x, y, w, h] = tall.slice(-4);
      punkt(x, y); punkt(x + w, y); punkt(x + w, y + h); punkt(x, y + h);
    } else if ("f F f* B B* b b* S s n".split(" ").includes(op)) {
      // W og W* setter klipp; da skal ikke banen telle som tegning
      lukk();
    } else if (op === "W" || op === "W*") { boks = null; }
    else if (op === "Do" && navn && dybde < 6) {
      const xo = res?.lookup(PDFName.of("XObject"), PDFDict);
      const form: any = xo?.lookup(PDFName.of(navn));
      if (form) {
        const dict: PDFDict = form.dict ?? form;
        const sub = String(dict.lookup(PDFName.of("Subtype")));
        if (sub === "/Form") {
          const mArr: any = dict.lookup(PDFName.of("Matrix"));
          const fm: Mat = mArr?.asArray ? (mArr.asArray().map((v: any) => v.asNumber()) as Mat) : ID;
          gaa(streamText(form), dict.lookup(PDFName.of("Resources"), PDFDict) ?? res,
              mul(fm, cur), dybde + 1, ut, tekst);
        } else if (sub === "/Image") {
          // et bilde fyller enhetsruta i gjeldende matrise
          punkt(0, 0); punkt(1, 0); punkt(1, 1); punkt(0, 1); lukk();
        }
      }
    }
    if (op !== "cs" && op !== "CS") tall = [];
    if (op !== "Do") navn = navn && (op === "gs" || op === "Tf") ? null : navn;
  }
  lukk();
}

export async function lesLett(pdf: Uint8Array): Promise<LettLest> {
  const doc = await PDFDocument.load(pdf, { ignoreEncryption: true });
  const page: any = doc.getPage(0);
  const res: PDFDict | undefined = page.node.Resources();
  const c: any = page.node.Contents();
  let data = "";
  if (c?.asArray) for (const r of c.asArray()) data += streamText(doc.context.lookup(r)) + "\n";
  else data = streamText(c);
  const bokser: Boks[] = [];
  const tekst: string[] = [];
  gaa(data, res, ID, 0, bokser, tekst);
  const mb: any = page.node.MediaBox();
  const v = mb?.asArray ? mb.asArray().map((x: any) => x.asNumber()) : [0, 0, 595, 842];
  const side: Boks = { x0: v[0], y0: v[1], x1: v[2], y1: v[3] };
  /**
   * Bakgrunnsflater, klipperammer og rester fra Illustrator kan spenne over
   * hele arket eller ligge utenfor det. De sier ingenting om hvor bilen er,
   * og de limer alle visningene sammen til en klump. Vekk med dem.
   */
  const sideAreal = (side.x1 - side.x0) * (side.y1 - side.y0);
  const rene = bokser.filter((b) => {
    if (b.x1 < side.x0 || b.x0 > side.x1 || b.y1 < side.y0 || b.y0 > side.y1) return false;
    return (b.x1 - b.x0) * (b.y1 - b.y0) < 0.5 * sideAreal;
  });
  return { tekst: tekst.join(""), bokser: rene, side };
}

/** Klyngedeling: forst vannrette band, sa kolonner i hvert band. */
function klynger(bokser: Boks[], glippe: number) {
  const bandene: Boks[][] = [];
  const sortY = [...bokser].sort((a, b) => a.y0 - b.y0);
  let gjeldende: Boks[] = [];
  let tak = -Infinity;
  for (const b of sortY) {
    if (gjeldende.length && b.y0 > tak + glippe) { bandene.push(gjeldende); gjeldende = []; tak = -Infinity; }
    gjeldende.push(b);
    tak = Math.max(tak, b.y1);
  }
  if (gjeldende.length) bandene.push(gjeldende);

  const ut: Boks[][] = [];
  for (const band of bandene) {
    const sortX = [...band].sort((a, b) => a.x0 - b.x0);
    let del: Boks[] = [];
    let kant = -Infinity;
    for (const b of sortX) {
      if (del.length && b.x0 > kant + glippe) { ut.push(del); del = []; kant = -Infinity; }
      del.push(b);
      kant = Math.max(kant, b.x1);
    }
    if (del.length) ut.push(del);
  }
  return ut;
}

export const ramme = (bs: Boks[]): Boks => ({
  x0: Math.min(...bs.map((b) => b.x0)), y0: Math.min(...bs.map((b) => b.y0)),
  x1: Math.max(...bs.map((b) => b.x1)), y1: Math.max(...bs.map((b) => b.y1)),
});

export interface Skisse {
  malestokkTekst: number | null;
  lengdeM: number | null; breddeM: number | null; hoydeM: number | null;
  visninger: { bredde: number; hoyde: number }[];
  malt: number | null;
  avvikProsent: number | null;
  merknader: string[];
}

export function tolk(lest: LettLest, glippeMm = 6): Skisse {
  const t = lest.tekst;
  const m = t.match(/1\s*:\s*(\d{1,3})/);
  const dim = (bokstav: string) => {
    const r = new RegExp(bokstav + "\\s*:\\s*(\\d+[.,]\\d+)");
    const f = t.match(r);
    return f ? Number(f[1].replace(",", ".")) : null;
  };
  const malestokkTekst = m ? Number(m[1]) : null;
  const lengdeM = dim("L"), breddeM = dim("B"), hoydeM = dim("H");

  const grupper = klynger(lest.bokser, glippeMm * MM)
    .map((g) => ramme(g))
    .map((r) => ({ bredde: (r.x1 - r.x0) / MM, hoyde: (r.y1 - r.y0) / MM }))
    .filter((v) => v.bredde > 20 && v.hoyde > 20)
    .sort((a, b) => b.bredde * b.hoyde - a.bredde * a.hoyde);

  const merknader: string[] = [];

  /**
   * En visning viser to av de tre malene. Hvilke to vet vi ikke, sa vi
   * prover alle tre parene og beholder den tolkningen der begge malene
   * peker paa omtrent samme malestokk.
   *
   * Alt som stikker ut, speil, antenne eller en strek noen har tegnet
   * utenfor bilen, gjor tegningen storre og malestokken tilsynelatende
   * mindre. Feilen gaar altsa alltid en vei, og da er den storste av
   * malestokkene den riktige.
   */
  const par: [number | null, number | null, string][] = [
    [lengdeM, hoydeM, "lengde og hoyde"],
    [lengdeM, breddeM, "lengde og bredde"],
    [breddeM, hoydeM, "bredde og hoyde"],
  ];
  const kandidater: number[] = [];
  for (const v of grupper) {
    for (const [a1, a2] of par) {
      if (!a1 || !a2) continue;
      const s1 = (a1 * 1000) / v.bredde, s2 = (a2 * 1000) / v.hoyde;
      if (Math.abs(s1 / s2 - 1) <= 0.2) kandidater.push(Math.max(s1, s2));
    }
  }
  kandidater.sort((a, b) => b - a);
  let malt: number | null = null;
  for (let i = 0; i + 1 < kandidater.length; i++) {
    if (Math.abs(kandidater[i + 1] / kandidater[i] - 1) <= 0.01) { malt = kandidater[i]; break; }
  }
  if (!malt) merknader.push("Ingen to mal stotter hverandre. Skissen er ikke til a stole pa.");

  let avvikProsent: number | null = null;
  if (malt && malestokkTekst) {
    avvikProsent = (malt / malestokkTekst - 1) * 100;
    const forhold = malestokkTekst / malt;
    if (Math.abs(avvikProsent) > 2) {
      merknader.push(`Teksten sier 1:${malestokkTekst}, malingen sier 1:${malt.toFixed(1)}.`);
      if (Math.abs(forhold - Math.round(forhold)) < 0.05 && Math.round(forhold) !== 1) {
        merknader.push(`Arket ser ut til a vaere skalert ${Math.round(forhold) * 100} prosent. Reell malestokk er 1:${malt.toFixed(0)}.`);
      }
    }
  }
  return { malestokkTekst, lengdeM, breddeM, hoydeM, visninger: grupper, malt, avvikProsent, merknader };
}
