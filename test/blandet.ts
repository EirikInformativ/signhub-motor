import * as fs from "fs";
import { kjorJobb } from "../src/motor";
const les = (p: string) => new Uint8Array(fs.readFileSync(p));
const HVIT = { kode: "751-010", hex: "#FFFFFF" };
const SORT = { kode: "751-070", hex: "#1A1A1A" };
const GUL  = { kode: "751-021", hex: "#F2E200", breddeMm: 1000 };
(async () => {
  const r = await kjorJobb({
    jobb: "Blandet folietest",
    linjer: [
      { navn: "Gabben", pdf: les("/home/claude/kunde/Gabben_Alversund.pdf"), breddeMm: 250, antall: 10, folie: HVIT },
      { navn: "Mundal", pdf: les("/home/claude/kunde/Mundal_Subsea.pdf"), hoydeMm: 120, styrende: "hoyde", antall: 7, folie: SORT },
      { navn: "OH Betong", pdf: les("/home/claude/kunde/OH_Betong.pdf"), breddeMm: 400, antall: 12, folie: SORT },
      { navn: "Klinikk", pdf: les("/home/claude/kunde/Klinikk_S_tran.pdf"), breddeMm: 600, antall: 6, folie: GUL },
    ],
  });
  for (const a of r.analyse) console.log(`  ${a.navn.padEnd(12)} ${a.breddeMm.toFixed(1).padStart(7)} x ${a.hoydeMm.toFixed(1).padStart(6)} mm  folie ${a.foliekode}`);
  for (const k of r.ark) console.log(`  ARK ${k.foliekode}  ${k.breddeMm} x ${k.lengdeMm.toFixed(1)} mm = ${k.kvadratmeter.toFixed(3)} m2, ${k.elementer} elementer`);
  for (const f of r.filer) { fs.writeFileSync("f_"+f.navn, f.bytes); console.log(`  ${f.slag.padEnd(12)} ${f.navn}`); }
})();
