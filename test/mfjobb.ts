import * as fs from "fs";
import { kjorJobb, analyserFil } from "../src/motor";
const pdf = new Uint8Array(fs.readFileSync("mf.pdf"));
const LILLA = { kode: "751-040", hex: "#BE19FF", breddeMm: 1260 };
const HVIT  = { kode: "751-010", hex: "#FFFFFF", breddeMm: 1260 };
const SORT  = { kode: "751-070", hex: "#1A1A1A", breddeMm: 1260 };
(async () => {
  const a = await analyserFil(pdf);
  console.log("FARGER I FILA, oyverst forst");
  a.farger.forEach((f, i) => console.log(`   ${i}: ${f.hex} ${(f.andel*100).toFixed(1)} %`));
  for (const lagvis of [true]) {
    const r = await kjorJobb({ jobb: "Martine", linjer: [
      { navn: "Martine Finsas", pdf, breddeMm: 600, antall: 4,
        folier: [LILLA, HVIT, SORT], lagvis }] });
    console.log(`\n${lagvis ? "LAGVIS" : "FLATE FOR FLATE"}`);
    for (const k of r.ark)
      console.log(`   ${k.rolle.padEnd(10)} ${k.foliekode}  ${k.breddeMm} x ${k.lengdeMm.toFixed(0)} mm`);
    const x = r.analyse[0];
    console.log(`   tynneste ${x.tynnesteMm.toFixed(2)} mm  ${x.status}`);
    for (const f of r.filer) if (f.slag === "produksjon")
      fs.writeFileSync((lagvis ? "mfL_" : "mfF_") + f.navn, f.bytes);
  }
})();
