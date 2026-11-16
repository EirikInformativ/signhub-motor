/**
 * Tett ark for dyr folie (Eirik 16.11.2026, Kia PV5: gront printet paa
 * hvit refleks, 498 + 45 kr/m², ca. 5 min aa legge over de 10 bitene).
 * Med pris skal motoren regne folie i oppsett mot folie tett pluss tid, og
 * velge det billigste. Uten pris roeres ingenting.
 */
import * as fs from "fs";
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
  const print = r.filer.filter((f: any) => / Print\+thru 751-068 100%\.pdf$/.test(f.navn));
  sjekk(print.length === 1, `én Print+thru-fil for refleksen (${r.filer.map((f: any) => f.navn).join(", ")})`);
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

  if (feil) { console.log(`\n${feil} feil`); process.exit(1); }
  console.log("\nok: tett ark velges naar det loenner seg");
})();
