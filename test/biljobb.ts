/**
 * Test: hele veien fra bilskisse til leveranse, gjennom det samme
 * grensesnittet SignHub skal bruke.
 */
import * as fs from "fs";
import { kjorJobb, lesBilskisse, foreslaFolier, DISCLAIMER, VANNMERKE } from "../src/motor";
import { createCanvas, loadImage } from "@napi-rs/canvas";

/** Liten demokatalog. I drift kommer folielisten fra SignHub. */
const KATALOG = [
  { kode: "751-010", hex: "#FFFFFF", breddeMm: 1260 },
  { kode: "751-070", hex: "#000000", breddeMm: 1260 },
  { kode: "751-031", hex: "#E6000D", breddeMm: 1260 },
  { kode: "751-086", hex: "#0033FF", breddeMm: 1260 },
  { kode: "751-068", hex: "#00A651", breddeMm: 1260 },
  { kode: "751-040", hex: "#BE19FF", breddeMm: 1260 },
];

(async () => {
  const fil = process.argv[2] ?? "proace2.pdf";
  const jobb = process.argv[3] ?? "Rosen Proace";
  const t0 = Date.now();

  const bilder = { disclaimer: await loadImage(DISCLAIMER), vannmerke: await loadImage(VANNMERKE) } as any;
  const lerret = (b: number, h: number) => createCanvas(Math.round(b), Math.round(h)) as any;

  const lest = await lesBilskisse(new Uint8Array(fs.readFileSync(fil)), { jobb, bilder, lerret });
  console.log(`malestokk 1:${lest.malestokk.toFixed(2)}  (arket sier 1:${lest.malestokkTekst})  ` +
    `L${lest.lengdeM} B${lest.breddeM} H${lest.hoydeM}`);
  console.log("VISNINGER: " + lest.visninger.map((v) => v.navn).join(", "));
  console.log("\nELEMENTER");
  const linjer = lest.elementer.map((e) => {
    // bakgrunnsplaten ligger fortsatt i PDF-en som nederste lag, men er
    // ikke et valg. Listen ma likevel holde folge med lagene der.
    const folier: any[] = foreslaFolier(e.farger, KATALOG as any);
    if (e.bakgrunn) folier.push("negativt");
    console.log(`   ${e.navn.padEnd(34)} ${e.breddeMm} x ${e.hoydeMm} mm  ${e.antall} stk  ` +
      e.farger.map((f, i) => `${f.hex}->${typeof folier[i] === "string" ? folier[i] : (folier[i] as any).kode}`).join(" "));
    return { navn: e.navn, pdf: e.pdf, breddeMm: e.breddeMm, antall: e.antall, folier };
  });

  const r = await kjorJobb({
    jobb, linjer, bilder, lerret, egenSkisse: false, snuOpp: true,
    kundeValg: { forside: lest.forside },
  } as any);

  const ut = "/tmp/ren/auto_";
  for (const f of r.filer) fs.writeFileSync(ut + f.navn, f.bytes);
  fs.writeFileSync(ut + "bilskisse_kunde.jpg", lest.forside.jpeg);

  console.log("\nARK");
  for (const k of r.ark) console.log(`   ${k.rolle.padEnd(10)} ${k.foliekode}  ${k.breddeMm} x ${k.lengdeMm.toFixed(0)} mm  ${k.elementer} elementer`);
  const alle = [...lest.merknader, ...r.advarsler];
  if (alle.length) console.log("\nMERKNADER OG ADVARSLER\n   " + alle.join("\n   "));
  console.log("\nFILER\n   " + r.filer.map((f: any) => f.navn).join("\n   "));
  console.log(`\ntotalt ${((Date.now() - t0) / 1000).toFixed(1)} s`);
})();
