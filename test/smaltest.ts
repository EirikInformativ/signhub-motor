import * as fs from "fs";
import { kjorJobb } from "../src/motor";
const les = (p: string) => new Uint8Array(fs.readFileSync(p));
const FOLIE = { kode: "820200-027G", hex: "#1A1A1A", breddeMm: 1260 };
(async () => {
  for (const [navn, antall] of [["én logo", 1], ["fire logoer", 4], ["tjue logoer", 20]] as [string, number][]) {
    const r = await kjorJobb({ jobb: "Smaltest", linjer: [
      { navn: "Informativ", pdf: les("/home/claude/Informativ_logo_rod_prikk.pdf"), breddeMm: 250, antall, folie: FOLIE }] });
    const k = r.ark[0];
    console.log(`${navn.padEnd(13)} ark ${k.breddeMm.toFixed(0).padStart(4)} x ${k.lengdeMm.toFixed(1).padStart(6)} mm = ` +
      `${k.kvadratmeter.toFixed(3)} m2  (hele rullen ${k.rullbreddeMm} gir ${k.rullforbrukM2.toFixed(3)} m2)`);
  }
})();
