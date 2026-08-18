import * as fs from "fs";
import { hentGeometri, hentGeometriPerFarge, areal, antallHull } from "../src/pdfbaner";
(async () => {
  const b = new Uint8Array(fs.readFileSync("kirke.pdf"));
  const en = await hentGeometri(b, 1.0);
  console.log(`samlet (hvit = hull): ${en.flate.length} flater, ${antallHull(en.flate)} hull, areal ${areal(en.flate).toFixed(1)}`);
  const per = await hentGeometriPerFarge(b, 1.0);
  console.log(`fargelag: ${per.lag.length}`);
  for (const l of per.lag) console.log(`   ${l.hex}  ${(l.andel*100).toFixed(1)} %  ${l.flate.length} flater, ${antallHull(l.flate)} hull`);
  console.log(`levende tekst: ${per.levendeTekst}`);
})();
