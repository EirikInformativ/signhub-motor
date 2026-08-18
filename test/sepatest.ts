import * as fs from "fs";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { kjorJobb, analyserFil, DISCLAIMER, VANNMERKE } from "../src/motor";

const les = (p: string) => new Uint8Array(fs.readFileSync(p));
const SORT = { kode: "751-070", hex: "#1A1A1A" };
const ROD  = { kode: "751-032", hex: "#E30613" };
const HVIT = { kode: "751-010", hex: "#FFFFFF" };

(async () => {
  const inf = les("/home/claude/Informativ_logo_rod_prikk.pdf");
  const a = await analyserFil(inf);
  console.log("ANALYSERFIL Informativ:", a.farger.map(f => `${f.hex} ${(f.andel*100).toFixed(1)}%`).join("  "),
    `| formatforhold ${a.formatforhold.toFixed(3)} | levende tekst ${a.levendeTekst}`);

  const r = await kjorJobb({
    jobb: "Separeringstest",
    linjer: [
      { navn: "Informativ", pdf: inf, breddeMm: 250, antall: 40, folier: [SORT, ROD] },
      { navn: "Informativ liten", pdf: inf, breddeMm: 100, antall: 20, folier: [SORT, ROD] },
      { navn: "Gabben", pdf: les("/home/claude/kunde/Gabben_Alversund.pdf"), breddeMm: 250, antall: 10, folie: HVIT },
    ],
    bilder: {
      disclaimer: await loadImage(Buffer.from(DISCLAIMER.split(",")[1], "base64")),
      vannmerke: await loadImage(Buffer.from(VANNMERKE.split(",")[1], "base64")),
    },
    lerret: (b, h) => createCanvas(Math.round(b), Math.round(h)) as any,
  });

  console.log("\nANALYSE");
  for (const x of r.analyse) console.log(`  ${x.navn.padEnd(18)} ${x.breddeMm.toFixed(1)} x ${x.hoydeMm.toFixed(1)} mm  folier: ${x.foliekoder.join(" + ")}`);
  console.log("\nARK");
  for (const k of r.ark) console.log(`  ${k.foliekode}  ${k.rolle.padEnd(10)} ${k.breddeMm} x ${k.lengdeMm.toFixed(1)} mm, ${k.elementer} plasseringer, ${k.regmarkSett} regmark-sett`);
  console.log("\nFILER");
  for (const f of r.filer) { fs.writeFileSync("sep_" + f.navn, f.bytes); console.log(`  ${f.navn} ${Math.round(f.bytes.length/1024)} kB`); }
  if (r.advarsler.length) { console.log("\nADVARSLER"); r.advarsler.forEach(x => console.log("  " + x)); }
})();
