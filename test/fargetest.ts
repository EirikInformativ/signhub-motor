import * as fs from "fs";
import { hentGeometri, hentGeometriPerFarge, areal, antallHull } from "../src/pdfbaner";

const FILER: [string, string][] = [
  ["Informativ rød prikk", "/home/claude/Informativ_logo_rod_prikk.pdf"],
  ["Mundal Subsea", "/home/claude/kunde/Mundal_Subsea.pdf"],
  ["Truck Agent", "/home/claude/kunde/Truck_Agent_Bergen.pdf"],
  ["OH Betong", "/home/claude/kunde/OH_Betong.pdf"],
  ["Klinikk Sætran", "/home/claude/kunde/Klinikk_S_tran.pdf"],
  ["Gabben", "/home/claude/kunde/Gabben_Alversund.pdf"],
];

(async () => {
  for (const [navn, sti] of FILER) {
    const b = new Uint8Array(fs.readFileSync(sti));
    const en = await hentGeometri(b, 1.0);
    const per = await hentGeometriPerFarge(b, 1.0);
    const sumLag = per.lag.reduce((s, l) => s + areal(l.flate), 0);
    console.log(`${navn}`);
    console.log(`  samlet: ${per.lag.length} farge(r), areal ${areal(en.flate).toFixed(1)}, ` +
      `sum lag ${sumLag.toFixed(1)}, avvik ${(100 * Math.abs(sumLag - areal(en.flate)) / areal(en.flate)).toFixed(3)} %`);
    for (const l of per.lag) {
      console.log(`    ${l.hex}  ${(l.andel * 100).toFixed(1).padStart(5)} %  ` +
        `${String(l.flate.length).padStart(3)} flater, ${String(antallHull(l.flate)).padStart(3)} hull`);
    }
  }
})();
