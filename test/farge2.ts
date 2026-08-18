import * as fs from "fs";
import { hentGeometriPerFarge, antallHull } from "../src/pdfbaner";
const F: [string,string][] = [
  ["Den norske kyrkje", "kirke.pdf"],
  ["Truck Agent", "/home/claude/kunde/Truck_Agent_Bergen.pdf"],
  ["Informativ rød prikk", "/home/claude/Informativ_logo_rod_prikk.pdf"],
  ["Mundal Subsea", "/home/claude/kunde/Mundal_Subsea.pdf"],
  ["Klinikk Sætran", "/home/claude/kunde/Klinikk_S_tran.pdf"],
];
(async () => {
  for (const [n, s] of F) {
    const g = await hentGeometriPerFarge(new Uint8Array(fs.readFileSync(s)), 1.0);
    console.log(n);
    for (const l of g.lag)
      console.log(`   ${l.hex} ${l.hvit ? "(hvit)" : "      "} ${(l.andel*100).toFixed(1).padStart(5)} %  ` +
        `${String(l.flate.length).padStart(3)} flater, ${String(antallHull(l.flate)).padStart(3)} hull`);
  }
})();
