import * as fs from "fs";
import { hentGeometriPerFarge, antallHull } from "../src/pdfbaner";
(async () => {
  const g = await hentGeometriPerFarge(new Uint8Array(fs.readFileSync("hb.ai")), 1.0);
  console.log("farger:", g.lag.length, "| levende tekst:", g.levendeTekst);
  for (const l of g.lag)
    console.log(`   ${l.hex} ${l.hvit ? "(hvit)" : "      "} ${(l.andel*100).toFixed(1).padStart(5)} %  ` +
      `${String(l.flate.length).padStart(3)} flater, ${String(antallHull(l.flate)).padStart(3)} hull`);
  console.log("bbox:", g.bbox.map(v=>v.toFixed(1)).join(", "));
})();
