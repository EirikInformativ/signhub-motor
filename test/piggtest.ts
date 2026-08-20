/**
 * Fanger nullbrede pigger i de ferdige skjaerefilene.
 *
 * Naar to flater deler en kant noyaktig, kan polygon-clipping legge igjen en
 * bane som gaar ut og rett tilbake langs samme linje. Den har null areal, men
 * den skjaeres, og da staar det en unodvendig strek midt i et helt element.
 * ryddFlate() i pdfbaner.ts skal fjerne dem.
 *
 * Piggen er skalaavhengig. Paa Nytveit-logoen viser den seg bare ved 500 mm
 * elementbredde, ikke ved 200, 300, 400, 460 eller 560. En enkelt bredde er
 * derfor ikke en test. Uten denne testen kan ryddFlate falle ut igjen uten at
 * noen merker det.
 *
 * Malt for ryddFlate ble lagt inn: ved 500 mm gav Nytveit noyaktig en pigg,
 * subbane 2 i N_sekundaer_751-086.pdf, mellom (118.9284, 99.6053) og
 * (52.1789, 99.4038) og rett tilbake. Det er den denne testen skal fange.
 *
 * Fasit na: null pigger ved alle bredder. Testen avslutter med kode 1 hvis
 * den finner noen.
 */
import * as fs from "fs";
import { kjorJobb } from "../src/motor";
import { PDFDocument, PDFRawStream, decodePDFRawStream, PDFName } from "pdf-lib";

const BREDDER = [200, 300, 400, 460, 500, 560];
const EPS = 1e-4;

/** Alle tegnede subbaner i en PDF, ogsa de som ligger i Form XObjects. */
async function subbaner(bytes: Uint8Array): Promise<[number, number][][]> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const ut: [number, number][][] = [];

  const les = (tekst: string) => {
    const tok = tekst.match(/-?[\d.]+|[A-Za-z*'"]+/g) ?? [];
    let tall: number[] = [];
    let bane: [number, number][] = [];
    const avslutt = () => { if (bane.length > 2) ut.push(bane); bane = []; };
    for (const k of tok) {
      if (/^-?[\d.]+$/.test(k)) { tall.push(parseFloat(k)); continue; }
      const p = (): [number, number] => [tall[tall.length - 2], tall[tall.length - 1]];
      if (k === "m") { avslutt(); bane = [p()]; }
      else if (k === "l" || k === "c") bane.push(p());
      else if (k === "h" || k === "f" || k === "f*" || k === "S" || k === "s"
               || k === "B" || k === "B*" || k === "b" || k === "n") avslutt();
      tall = [];
    }
    avslutt();
  };

  for (let i = 0; i < doc.getPageCount(); i++) {
    const side: any = doc.getPage(i);
    const c = side.node.Contents();
    const b = c instanceof PDFRawStream ? decodePDFRawStream(c).decode() : c?.getContents?.();
    if (b) les(new TextDecoder("latin1").decode(b));
    const xo: any = side.node.Resources()?.lookup(PDFName.of("XObject"));
    if (xo?.keys) for (const n of xo.keys()) {
      try {
        les(new TextDecoder("latin1").decode(decodePDFRawStream(xo.lookup(n)).decode()));
      } catch { /* ikke en lesbar strom */ }
    }
  }
  return ut;
}

/** Punkt i og i+2 sammenfaller, mens i+1 ligger et annet sted: ut og rett tilbake. */
function pigger(baner: [number, number][][]): string[] {
  const funn: string[] = [];
  baner.forEach((r, bi) => {
    for (let i = 0; i < r.length; i++) {
      const a = r[i], b = r[(i + 1) % r.length], c = r[(i + 2) % r.length];
      const tilbake = Math.abs(a[0] - c[0]) < EPS && Math.abs(a[1] - c[1]) < EPS;
      const flyttet = Math.abs(a[0] - b[0]) > EPS || Math.abs(a[1] - b[1]) > EPS;
      if (tilbake && flyttet) {
        funn.push(`subbane ${bi}: (${a[0].toFixed(4)}, ${a[1].toFixed(4)}) -> ` +
                  `(${b[0].toFixed(4)}, ${b[1].toFixed(4)}) og rett tilbake`);
      }
    }
  });
  return funn;
}

(async () => {
  const pdf = new Uint8Array(fs.readFileSync("nytveit.ai"));
  const folier = [
    { kode: "751-031", hex: "#BC0000", breddeMm: 1220 },
    { kode: "751-086", hex: "#0012F2", breddeMm: 1220 },
  ];

  let totalt = 0;
  for (const breddeMm of BREDDER) {
    const r: any = await kjorJobb({
      jobb: "Pigg", linjer: [{ navn: "Nytveit", pdf, breddeMm, antall: 1, folier } as any],
    });
    const treff: string[] = [];
    for (const f of r.filer) {
      if (!f.navn.endsWith(".pdf") || f.navn.includes("skisse")) continue;
      for (const t of pigger(await subbaner(f.bytes))) treff.push(`${f.navn}: ${t}`);
    }
    totalt += treff.length;
    console.log(`${String(breddeMm).padStart(4)} mm   ${treff.length ? `${treff.length} PIGG` : "0 pigger"}`);
    for (const t of treff) console.log(`           ${t}`);
  }

  console.log();
  if (totalt) {
    console.log(`FEIL: ${totalt} nullbred(e) pigg(er). ryddFlate() virker ikke.`);
    process.exit(1);
  }
  console.log(`ok: ingen pigger ved ${BREDDER.length} bredder`);
})();
