import * as fs from "fs";
import { kjorJobb } from "../src/motor";
const les = (p: string) => new Uint8Array(fs.readFileSync(p));
// bred logo pa smal rull: tvinger arket helt ut mot grensen
(async () => {
  for (const bredde of [1100, 1150, 1180, 1200]) {
    const r = await kjorJobb({ jobb: "Grense", linjer: [{ navn: "Mundal",
      pdf: les("/home/claude/kunde/Mundal_Subsea.pdf"), breddeMm: bredde, antall: 3,
      folie: { kode: "751-070", hex: "#1A1A1A", breddeMm: 1260 } }] });
    const k = r.ark[0];
    const filer = r.filer.filter(f => f.slag === "produksjon").length;
    console.log(`logo ${bredde} mm -> ark ${k.breddeMm} mm, ytterste kutt ${(k.breddeMm - 10)} mm, ${filer} produksjonsfiler`);
    r.advarsler.filter(a => a.includes("Wild")).forEach(a => console.log("    " + a));
  }
})();
