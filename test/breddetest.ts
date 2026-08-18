import * as fs from "fs";
import { kjorJobb } from "../src/motor";
const les = (p: string) => new Uint8Array(fs.readFileSync(p));
const KLINIKK = les("/home/claude/kunde/Klinikk_S_tran.pdf");

const tilfeller: [string, any][] = [
  ["rull 1000", { kode: "751-070", hex: "#1A1A1A", breddeMm: 1000 }],
  ["rull 1220", { kode: "751-070", hex: "#1A1A1A", breddeMm: 1220 }],
  ["rull 1240", { kode: "751-070", hex: "#1A1A1A", breddeMm: 1240 }],
  ["rull 1260", { kode: "751-070", hex: "#1A1A1A", breddeMm: 1260 }],
  ["rull 1520", { kode: "751-070", hex: "#1A1A1A", breddeMm: 1520 }],
  ["rull 1600", { kode: "751-070", hex: "#1A1A1A", breddeMm: 1600 }],
];

(async () => {
  for (const [navn, folie] of tilfeller) {
    const r = await kjorJobb({
      jobb: "Breddetest",
      linjer: [{ navn: "Klinikk", pdf: KLINIKK, breddeMm: 600, antall: 12, folie }],
    });
    const k = r.ark[0];
    const filer = r.filer.filter(f => f.slag === "produksjon").map(f => f.navn.split("_")[1]).join(", ");
    console.log(`${navn.padEnd(12)} ark ${String(k.breddeMm).padStart(4)} | skjær ${String(k.skjaerebreddeMm).padStart(4)} | ` +
      `lengde ${k.lengdeMm.toFixed(0).padStart(4)} | ${filer}`);
    r.advarsler.filter(a => a.includes("Wild")).forEach(a => console.log("     " + a));
  }
})();
