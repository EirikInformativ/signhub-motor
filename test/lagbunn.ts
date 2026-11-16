/**
 * Fargen som danner ytterkanten legges i bunn som ett helt stykke, og
 * motoren sier fra om levende tekst og om samme merke sett fra to visninger.
 *
 * XL-logoen paa 309916 e-expert: gullramme, svart rute innenfor, gull XL
 * oppaa. Tegnet slik ligger svart i bunn, og hele ytterkanten av den svarte
 * ruten maa treffe innerkanten av gullrammen ved montering. Ellers kommer
 * en tynn stripe fram (Eirik 16.11.2026). Riktig oppbygging: gull i bunn
 * som ett rektangel, svart oppaa med XL skaaret ut.
 *
 * Fasit:
 *  - XL-boksen: svart er primaer (oeverst), gull ligger i bunn, og gull-
 *    laget er ett stykke uten hull: arealet er lik rammen.
 *  - «XL-BYGG Osteroy» paa bakluken og paa den ene siden er levende tekst
 *    og meldes ved elementet sitt.
 *  - XL PROFF paa panseret i frontvisningen meldes som samme merke som
 *    det i toppvisningen.
 */
import * as fs from "fs";
import { kjorJobb, lesBilskisse, DISCLAIMER, VANNMERKE } from "../src/motor";
import { hentGeometriPerFarge } from "../src/pdfbaner";
import * as pcModul from "polygon-clipping";
const pc: any = (pcModul as any).default ?? pcModul;
import { createCanvas, loadImage } from "@napi-rs/canvas";

const GULL = { kode: "900-991", hex: "#D7C46D", breddeMm: 1260 };
const SORT = { kode: "751-070", hex: "#000000", breddeMm: 1260 };

(async () => {
  let feil = 0;
  const sjekk = (ok: boolean, t: string) => { console.log(`${ok ? "ok  " : "FEIL"} ${t}`); if (!ok) feil++; };
  const bilder = { disclaimer: await loadImage(DISCLAIMER), vannmerke: await loadImage(VANNMERKE) } as any;
  const lerret = (b: number, h: number) => createCanvas(Math.round(b), Math.round(h)) as any;
  const lest = await lesBilskisse(new Uint8Array(fs.readFileSync("eexpert.pdf")), { jobb: "x", bilder, lerret });

  const xl = lest.elementer.find((e) => e.breddeMm === 777)!;
  const r: any = await kjorJobb({ jobb: "XL", linjer: [{ navn: "XL", pdf: xl.pdf, breddeMm: 777, antall: 1,
    folier: xl.farger.map((f) => f.hex === "#D7C46D" ? GULL : SORT) }] } as any);
  const prim = r.ark.find((a: any) => a.rolle === "primær");
  sjekk(prim?.foliekode === "751-070", `XL: svart oeverst som primaer (fikk ${prim?.foliekode})`);
  sjekk(r.advarsler.some((a: string) => /danner ytterkanten/.test(a)), "XL: melding om at gull er lagt i bunn");

  // gull-laget skal vaere ett helt stykke: like mange hull som hele motivet
  // har (aapninger der lakken skal synes), ingen flere
  const per = await hentGeometriPerFarge(xl.pdf, 1);
  const synlig: any = pc.union(...(per.lag.filter((l: any) => l.hex !== "#FFFFFF").map((l: any) => l.flate) as [any]));
  const motivHull = synlig.reduce((a: number, p: any) => a + p.length - 1, 0);
  const gullfil = r.filer.find((f: any) => f.navn.includes("900-991"));
  const gull = await hentGeometriPerFarge(gullfil.bytes, 1);
  const gullLag = gull.lag.find((l: any) => !["#FFFFFF", "#FF00FF", "#00FFFF"].includes(l.hex));
  const hull = gullLag ? gullLag.flate.reduce((a: number, p: any) => a + p.length - 1, 0) : -1;
  sjekk(!!gullLag && gullLag.flate.length === 1 && hull === motivHull,
    `XL: gull i bunn er ett stykke (${gullLag?.flate.length} del, ${hull} hull, motivet har ${motivHull})`);

  const tekst = lest.levendeTekst.filter((t) => t.element && /Osterøy/.test(t.tekst));
  sjekk(tekst.length === 2, `levende tekst «XL-BYGG Osterøy» meldt ved 2 elementer (fikk ${tekst.length})`);
  sjekk(lest.merknader.some((m) => /IKKE med i skjaerefilene/.test(m)), "levende tekst gir tydelig merknad");

  const dobbel = lest.elementer.filter((e) => e.sammeSom);
  sjekk(dobbel.length === 1 && dobbel[0].breddeMm === 978 && dobbel[0].hoydeMm === 55,
    `panseret i frontvisningen meldt som samme merke (${dobbel.map((e) => e.navn + " = " + e.sammeSom).join(", ")})`);
  sjekk(lest.elementer.length === 11, "ingen elementer fjernet av den grunn");

  if (feil) { console.log(`\n${feil} feil`); process.exit(1); }
  console.log("\nok: ytterkanten i bunn, tekst og doble merker meldes");
})();
