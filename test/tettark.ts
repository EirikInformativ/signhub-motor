/**
 * Tett ark for dyr folie (Eirik 16.11.2026, Kia PV5: gront printet paa
 * hvit refleks, 498 + 45 kr/m², ca. 5 min aa legge over de 10 bitene).
 * Med pris skal motoren regne folie i oppsett mot folie tett pluss tid, og
 * velge det billigste. Uten pris roeres ingenting.
 */
import * as fs from "fs";
import { PDFDocument, PDFOperator } from "pdf-lib";
import { lesBilskisse, kjorJobb, DISCLAIMER, VANNMERKE } from "../src/motor";
import { createCanvas, loadImage } from "@napi-rs/canvas";

let feil = 0;
const sjekk = (ok: boolean, t: string) => { console.log(`${ok ? "ok  " : "FEIL"} ${t}`); if (!ok) feil++; };
(async () => {
  const l: any = await lesBilskisse(new Uint8Array(fs.readFileSync("kia.pdf")), { jobb: "kia",
    bilder: { disclaimer: await loadImage(DISCLAIMER), vannmerke: await loadImage(VANNMERKE) },
    lerret: (b: number, h: number) => createCanvas(Math.round(b), Math.round(h)) } as any);
  const G = "#00B528", S = "#000000";
  const kjor = async (gronn: any, ekstra: any = {}) => kjorJobb({ jobb: "kia", egenSkisse: false, ...ekstra,
    linjer: l.elementer.filter((e: any) => !e.sammeSom).map((e: any) => ({ navn: e.navn, pdf: e.pdf, breddeMm: e.breddeMm,
      antall: e.antall, folier: e.farger.map((f: any) => f.hex === G ? gronn : { kode: "751-070", hex: S, breddeMm: 1260 }) })) } as any);

  // refleks med print: ut av oppsettet, tett, Print+thru med regmarks
  const r: any = await kjor({ kode: "751-068", hex: G, breddeMm: 1260, prisM2: 543, print: true });
  const melding = r.advarsler.find((a: string) => /751-068: tatt ut av oppsettet/.test(a));
  sjekk(!!melding, `refleksen tas ut av oppsettet (${melding ?? r.advarsler.filter((a: string) => /oppsett/.test(a)).join(" ")})`);
  sjekk(/10 biter/.test(melding ?? ""), "10 biter legges over for hand");
  // bitene til én logo er én gruppe: kiss rundt bitene, thru utenfor (Print+kiss+thru)
  const print = r.filer.filter((f: any) => / Print\+kiss\+thru 751-068 100%\.pdf$/.test(f.navn));
  sjekk(print.length === 1, `én Print+kiss+thru-fil for refleksen (${r.filer.map((f: any) => f.navn).join(", ")})`);
  // stripene har sin egen fil; logogruppene skal over paa det sorte oppsettet
  // og kjoeres aldri paa samme ark som stripene (Eirik 16.11.2026)
  sjekk(r.filer.some((f: any) => / Print\+thru 751-068 100%\.pdf$/.test(f.navn)), "stripene paa eget ark (Print+thru)");
  const tettArket = r.ark.filter((a: any) => a.foliekode === "751-068").map((a: any) => a.lengdeMm);
  sjekk(tettArket.length === 2 && Math.min(...tettArket) < 500,
    `logogruppene nestet paa formen, med rotasjon (${tettArket.map((x: number) => x.toFixed(0)).join(" og ")} mm)`);
  const tekst = async (f: any) => {
    const b = f.bytes ?? await f._bygg();
    const d = await PDFDocument.load(b);
    const c: any = d.getPage(0).node.Contents();
    const { decodePDFRawStream } = await import("pdf-lib");
    const raa = new TextDecoder("latin1").decode(decodePDFRawStream(d.context.lookup(c) as any).decode());
    const cs = String((d.getPage(0).node as any).Resources().lookup((await import("pdf-lib")).PDFName.of("ColorSpace")));
    return { raa, cs, alt: new TextDecoder("latin1").decode(b) };
  };
  if (print.length) {
    const p = await tekst(print[0]);
    // spotfargen fra skissen, ikke skjermfargen (Eirik 16.11.2026)
    const sep = [...p.cs.matchAll(/\/CS2 (\d+) 0 R/g)];
    sjekk(/\/CS2 cs/.test(p.raa) && sep.length === 1, "printet fyll bruker egen spotfarge (CS2)");
    const pd = await PDFDocument.load(print[0].bytes ?? await print[0]._bygg());
    const obj = String(pd.context.lookup(pd.context.obj(0) as any) ?? "");
    const alle = [...pd.context.enumerateIndirectObjects()].map(([, o]) => String(o)).join("\n");
    sjekk(/PANTONE#207481#20C/.test(alle) && /\/Lab/.test(alle), "spotfargen heter PANTONE 7481 C og beholder Lab-alternativet");
    sjekk(/\/L3 BDC[\s\S]*\/CS1 CS/.test(p.raa), "bitene har kiss-cut");
    void obj;
  }
  // oppsettet viser det gronne med fyll og kiss-strek, saa montoeren ser hvor det skal
  const sort = r.filer.find((f: any) => / Kiss\+thru 751-070 100%\.pdf$/.test(f.navn));
  if (sort) {
    const s2 = await tekst(sort);
    sjekk(s2.raa.includes("0.0000 0.7098 0.1569 rg"), "oppsettet i sort viser det gronne (fyll og kiss-strek)");
  } else sjekk(false, "det sorte oppsettet finnes");
  sjekk(!r.filer.some((f: any) => / Kiss 751-068 | Kiss\+thru 751-068 /.test(f.navn)), "det gronne er ikke lenger i oppsettet");
  const gronnArk = r.ark.filter((a: any) => a.foliekode === "751-068").reduce((s: number, a: any) => s + a.lengdeMm, 0);
  sjekk(gronnArk < 1000, `refleks under 1 m (${gronnArk.toFixed(0)} mm, mot 2 113 i oppsett)`);
  sjekk(r.ark.find((a: any) => a.foliekode === "751-068").regmarkSett > 0, "Print+thru har regmarks");

  // uten pris: ingenting endres
  const u: any = await kjor({ kode: "751-068", hex: G, breddeMm: 1260 });
  sjekk(!u.advarsler.some((a: string) => /oppsettet/.test(a)), "uten pris vurderes ikke tett ark");

  // dyr tid: beholdes i oppsettet, med regnestykket
  const t: any = await kjor({ kode: "751-068", hex: G, breddeMm: 1260, prisM2: 76.42 }, { overteipMinPerBit: 5 });
  sjekk(t.advarsler.some((a: string) => /751-068: beholdt i oppsettet\..*Grensen er \d+ minutter/.test(a)),
    "billig folie og lang overteiping: beholdt i oppsettet, grensen meldes");

  /**
   * Materialet sier om det KAN printes; innholdet avgjoer (Eirik
   * 16.11.2026): hvitt paa printmedium skjaeres, det printes ikke.
   */
  const lagPdf = async (rg: string) => {
    const d = await PDFDocument.create(); const side = d.addPage([200, 100]);
    (side as any).pushOperators(...[`${rg} rg`, "10 10 180 40 re", "f"].map((x) => PDFOperator.of(x as any)));
    return d.save();
  };
  for (const [rg, hex, venter] of [["1 1 1", "#FFFFFF", "Appliser+thru"], ["0 0.71 0.157", "#00B528", "Print+thru"]] as const) {
    const pdf = await lagPdf(rg);
    const w: any = await kjorJobb({ jobb: "hvit", egenSkisse: false, linjer: [{ navn: "felt", pdf, breddeMm: 300, antall: 1,
      folier: [{ kode: "3M-refleks", hex, breddeMm: 1260, print: true }] }] } as any);
    const navn = w.filer.filter((f: any) => f.slag === "produksjon").map((f: any) => f.navn).join(", ");
    sjekk(new RegExp(` ${venter.replace("+", "\\+")} 3M-refleks`).test(navn), `${hex} paa printmedium gir ${venter} (${navn})`);
  }

  if (feil) { console.log(`\n${feil} feil`); process.exit(1); }
  console.log("\nok: tett ark velges naar det loenner seg");
})();
