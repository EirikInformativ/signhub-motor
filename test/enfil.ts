import * as fs from "fs";
import { kjorJobb } from "../src/motor";
(async () => {
  const r = await kjorJobb({ jobb: "En", linjer: [
    { navn: "Informativ", pdf: new Uint8Array(fs.readFileSync("/home/claude/Informativ_logo_rod_prikk.pdf")),
      breddeMm: 250, antall: 1,
      folier: [{ kode: "820200-027G", hex: "#1A1A1A", breddeMm: 1260 },
               { kode: "820200-010G", hex: "#FFFFFF", breddeMm: 1260 }] }] });
  for (const f of r.filer) if (f.slag === "produksjon") fs.writeFileSync("en_" + f.navn, f.bytes);
  for (const k of r.ark) console.log(`${k.foliekode} ${k.rolle}: ${k.breddeMm.toFixed(0)} x ${k.lengdeMm.toFixed(1)} mm`);
})();
