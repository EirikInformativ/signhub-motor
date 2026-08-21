/**
 * Vakten rundt kuttingen per element og farge.
 *
 * Motoren krasjet i produksjon paa bakgrunnsplaten i Rosen-logoen med
 *
 *   Unable to find segment #52671 25.377125, 10.503875 til
 *   25.401951614863158, 10.524788266040684 in SweepLine tree
 *
 * rett ut i appen. Det er polygon-clipping som mister tellingen paa
 * hakkete geometri. At platen ikke lenger skjaeres fjerner aarsaken, men
 * motoren skal uansett ikke kunne kastes ut med en raa biblioteksfeil.
 *
 * Vakten proever en gang til paa ryddet geometri, og gaar det fortsatt
 * ikke, sier den hvilket element og hvilken farge det gjelder. Brukeren
 * skal aldri se SweepLine tree.
 */
import * as fs from "fs";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { kuttTrygt, areal } from "../src/pdfbaner";
import type { MultiPoly } from "../src/pdfbaner";
import { lesBilskisse, kjorJobb, DISCLAIMER, VANNMERKE } from "../src/motor";
import { foreslaFolier } from "../src/bilmotor";

let feil = 0;
const sjekk = (navn: string, ok: boolean, detalj = "") => {
  console.log(`   ${ok ? "ok  " : "FEIL"}  ${navn}${detalj ? "  — " + detalj : ""}`);
  if (!ok) feil++;
};

/** ordrett slik polygon-clipping kaster den */
const SWEEP = "Unable to find segment #52671 25.377125, 10.503875 -> " +
  "25.401951614863158, 10.524788266040684 in SweepLine tree";

const RUTE: MultiPoly = [[[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]]];
/** samme rute, men med et kollineart punkt ryddFlate tar bort */
const HAKK: MultiPoly = [[[[0, 0], [5, 0], [10, 0], [10, 10], [0, 10], [0, 0]]]];

const demp = <T>(f: () => T): T => {
  const w = console.warn, e = console.error;
  console.warn = () => {}; console.error = () => {};
  try { return f(); } finally { console.warn = w; console.error = e; }
};

(async () => {
  console.log("1. vakten fanger biblioteksfeilen");

  let kastet = "";
  try {
    demp(() => kuttTrygt("Rosen ende hoyre dekor 1", "#FFFFFF (folie 751-010)",
      () => { throw new Error(SWEEP); }, RUTE));
  } catch (e: any) { kastet = e.message; }

  sjekk("kaster var egen feil", kastet !== "");
  sjekk("navngir elementet", /Rosen ende hoyre dekor 1/.test(kastet));
  sjekk("navngir fargen", /#FFFFFF/.test(kastet) && /751-010/.test(kastet),
    kastet.slice(0, 80) + "...");
  sjekk("brukeren ser aldri SweepLine tree",
    !/SweepLine/i.test(kastet) && !/segment #/i.test(kastet));

  console.log("\n2. andre forsok gaar paa ryddet geometri");

  let forsok = 0;
  const bareRent = (f: MultiPoly): MultiPoly => {
    forsok++;
    // feiler saa lenge det ligger et kollineart punkt i banen
    if (f[0][0].length > 5) throw new Error(SWEEP);
    return f;
  };
  const svar = demp(() => kuttTrygt("Element", "#0033FF", bareRent, HAKK));
  sjekk("gikk gjennom paa andre forsok", areal(svar) === 100,
    `${forsok} forsok, areal ${areal(svar)}`);
  sjekk("forsokte noyaktig to ganger", forsok === 2, `${forsok}`);

  let en = 0;
  kuttTrygt("Element", "#0033FF", (f) => { en++; return f; }, RUTE);
  sjekk("ingen omkjoring naar forste forsok gaar bra", en === 1, `${en} forsok`);

  console.log("\n3. proace2: bakgrunnen tvinges gjennom kuttingen");

  const bilder = {
    disclaimer: await loadImage(DISCLAIMER),
    vannmerke: await loadImage(VANNMERKE),
  } as any;
  const lest = await lesBilskisse(new Uint8Array(fs.readFileSync("proace2.pdf")), {
    jobb: "Rosen", bilder,
    lerret: (b: number, h: number) => createCanvas(Math.round(b), Math.round(h)) as any,
  });
  const KATALOG: any[] = [
    { kode: "751-010", hex: "#FFFFFF", breddeMm: 1260 },
    { kode: "751-031", hex: "#E6000D", breddeMm: 1260 },
    { kode: "751-086", hex: "#0033FF", breddeMm: 1260 },
  ];
  const HVIT = KATALOG[0];

  for (const e of lest.elementer) {
    if (!(e as any).bakgrunn) { sjekk(`${e.navn}: har bakgrunnsplate`, false); continue; }
    // slik det saa ut da det krasjet: platen skjaeres i hvit folie
    const folier: any[] = [...foreslaFolier(e.farger, KATALOG as any), HVIT];
    let utfall = "";
    try {
      const r = await demp(() => kjorJobb({ jobb: "Rosen", linjer: [
        { navn: e.navn, pdf: (e as any).pdf ?? e.pdf, breddeMm: 300, antall: 1,
          folier }] } as any));
      utfall = `gikk gjennom, ${r.filer.length} filer`;
    } catch (err: any) {
      utfall = err.message;
    }
    const gikk = /gikk gjennom/.test(utfall);
    const vaar = new RegExp(e.navn.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).test(utfall)
      && /klarte ikke skjaere|ikke skjaere fargen|fant ingen baner|mangler/i.test(utfall);
    sjekk(`${e.navn}: gaar gjennom eller feiler med var egen tekst`, gikk || vaar,
      utfall.slice(0, 90));
    sjekk(`${e.navn}: ingen raa biblioteksfeil`,
      !/SweepLine/i.test(utfall) && !/segment #/i.test(utfall));
  }

  console.log("\n4. ogsaa feil fra lesingen og separeringen navngir elementet");

  let raa = "";
  try {
    await kjorJobb({ jobb: "Rosen", linjer: [
      { navn: "Rosen bakluke", pdf: new Uint8Array([1, 2, 3, 4]),
        breddeMm: 300, antall: 1,
        folier: [{ kode: "751-010", hex: "#FFFFFF", breddeMm: 1260 }] }] } as any);
  } catch (e: any) { raa = e.message; }
  sjekk("feil fra lesingen starter med elementnavnet",
    raa.startsWith("Rosen bakluke:"), raa.slice(0, 70) + "...");

  console.log(feil === 0 ? "\nok: vakten holder, ingen raa biblioteksfeil slipper ut"
                         : `\nFEIL: ${feil} sjekker feilet`);
  if (feil) process.exit(1);
})();
