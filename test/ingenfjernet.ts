/**
 * Motoren fjerner ALDRI noe fra en logo (Eirik 16.11.2026).
 *
 * Martine Finsas har harfine biter etter lagdelingen. Tidligere ble de
 * fjernet. Na skal de bli staende, tynneste detalj skal vise dem
 * (0,85 mm, kritisk), og advarselen skal si at ingenting er fjernet.
 */
import * as fs from "fs";
import { kjorJobb } from "../src/motor";
const pdf = new Uint8Array(fs.readFileSync("mf.pdf"));
(async () => {
  const r: any = await kjorJobb({ jobb: "MF", linjer: [{ navn: "MF", pdf, breddeMm: 600, antall: 1,
    folier: [{ kode: "751-040", hex: "#BE19FF" }, { kode: "751-010", hex: "#FFFFFF" }, { kode: "751-070", hex: "#1A1A1A" }] }] });
  let feil = 0;
  const sjekk = (navn: string, ok: boolean, d = "") => { console.log(`   ${ok ? "ok  " : "FEIL"}  ${navn}${d ? "  — " + d : ""}`); if (!ok) feil++; };
  sjekk("ingen advarsel om at noe er fjernet",
    !r.advarsler.some((a: string) => /fjernet fra/.test(a)), r.advarsler.join(" | "));
  sjekk("advarsel om sma biter sier at ingenting er fjernet",
    r.advarsler.some((a: string) => /Ingenting er fjernet/.test(a)));
  const t = r.analyse[0].tynnesteMm;
  sjekk("tynneste detalj viser de sma bitene (under 1 mm)", t < 1, t.toFixed(2) + " mm");
  if (feil) { console.log(`\n${feil} feil`); process.exit(1); }
  console.log("\nok: ingenting fjernes, alt meldes");
})();
