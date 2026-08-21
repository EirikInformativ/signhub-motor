/**
 * Bakgrunnsplaten skal ikke vaere et valg.
 *
 * Rosen-logoen er tegnet paa en hvit plate som utgjor rundt 73 prosent av
 * motivet i 13 biter etter at bokstavene er skaaret fra. Den er ikke
 * dekor, den er mellomrommet, og paa bilen er det lakken. Meldes den som
 * en farge blant de andre, foreslaas den som folie, og appen tilbyr klar
 * folie over tre firedeler av logoen.
 *
 * Er bunnen formet, for eksempel en badge med tekst oppa, er den et ekte
 * element og skal staa.
 */
import * as fs from "fs";
import { PDFDocument, rgb } from "pdf-lib";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { lesBilskisse, DISCLAIMER, VANNMERKE } from "../src/motor";
import { erBakgrunnsplate } from "../src/bilmotor";
import { hentGeometriPerFarge } from "../src/pdfbaner";

let feil = 0;
const sjekk = (navn: string, ok: boolean, detalj = "") => {
  console.log(`   ${ok ? "ok  " : "FEIL"}  ${navn}${detalj ? "  — " + detalj : ""}`);
  if (!ok) feil++;
};

/** rektangulaer plate med to former oppa: en ekte bakgrunnsplate */
async function plate(): Promise<Uint8Array> {
  const d = await PDFDocument.create();
  const p = d.addPage([200, 100]);
  p.drawRectangle({ x: 0, y: 0, width: 200, height: 100, color: rgb(1, 1, 1) });
  p.drawRectangle({ x: 20, y: 20, width: 60, height: 60, color: rgb(0, 0.2, 1) });
  p.drawRectangle({ x: 120, y: 20, width: 60, height: 60, color: rgb(0.9, 0, 0.05) });
  return d.save();
}

/** formet bunn: en oval badge med tekst oppa. Skal beholdes. */
async function badge(): Promise<Uint8Array> {
  const d = await PDFDocument.create();
  const p = d.addPage([200, 100]);
  p.drawEllipse({ x: 100, y: 50, xScale: 100, yScale: 50, color: rgb(1, 1, 1) });
  p.drawRectangle({ x: 60, y: 40, width: 30, height: 20, color: rgb(0, 0.2, 1) });
  p.drawRectangle({ x: 110, y: 40, width: 30, height: 20, color: rgb(0.9, 0, 0.05) });
  return d.save();
}

const fyllgrad = async (bytes: Uint8Array) => {
  const per = await hentGeometriPerFarge(bytes, 1.0);
  return { per, plate: erBakgrunnsplate(per.lag.map((l) => l.flate), per.bbox) };
};

(async () => {
  console.log("1. formen avgjor, ikke fargen");

  const p1 = await fyllgrad(await plate());
  sjekk("rektangulaer plate kjennes igjen", p1.plate,
    `${p1.per.lag.length} lag, bunn ${p1.per.lag[p1.per.lag.length - 1].hex}`);

  const p2 = await fyllgrad(await badge());
  sjekk("oval badge beholdes", !p2.plate,
    `${p2.per.lag.length} lag, bunn ${p2.per.lag[p2.per.lag.length - 1].hex}`);

  // begge har hvit bunn: det er formen som skiller dem, ikke fargen
  sjekk("begge har hvit bunn, saa fargen skiller dem ikke",
    p1.per.lag[p1.per.lag.length - 1].hex === "#FFFFFF" &&
    p2.per.lag[p2.per.lag.length - 1].hex === "#FFFFFF");

  console.log("\n2. proace2: ingen skal melde hvit som valgbar farge");

  const bilder = {
    disclaimer: await loadImage(DISCLAIMER),
    vannmerke: await loadImage(VANNMERKE),
  } as any;
  const lest = await lesBilskisse(new Uint8Array(fs.readFileSync("proace2.pdf")), {
    jobb: "Rosen", bilder,
    lerret: (b: number, h: number) => createCanvas(Math.round(b), Math.round(h)) as any,
  });

  sjekk("fire elementer", lest.elementer.length === 4, `${lest.elementer.length}`);

  for (const e of lest.elementer) {
    const hvit = e.farger.filter((f) => f.hex === "#FFFFFF");
    sjekk(`${e.navn}: hvit ikke tilbudt`, hvit.length === 0,
      e.farger.map((f) => f.hex).join(" "));
    sjekk(`${e.navn}: platen er tatt vare paa`, !!(e as any).bakgrunn,
      (e as any).bakgrunn
        ? `${(e as any).bakgrunn.hex} ${((e as any).bakgrunn.andel * 100).toFixed(1)} %`
        : "mangler");
  }

  const meldt = lest.merknader.filter((m) => /bakgrunnsplaten/.test(m));
  sjekk("meldt i merknader, med farge og andel", meldt.length === 4,
    `${meldt.length} merknader`);
  sjekk("merknaden navngir farge og andel",
    meldt.every((m) => /#FFFFFF/.test(m) && /\d+\.\d %/.test(m)),
    meldt[0]?.slice(0, 70) + "...");

  console.log(feil === 0 ? "\nok: bakgrunnsplaten holdes utenfor, formet bunn beholdes"
                         : `\nFEIL: ${feil} sjekker feilet`);
  if (feil) process.exit(1);
})();
