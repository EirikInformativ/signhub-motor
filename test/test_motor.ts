import * as fs from "fs";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { kjorJobb } from "../src/motor";
import { DISCLAIMER, VANNMERKE } from "../src/assets";

(async () => {
  const les = (p: string) => new Uint8Array(fs.readFileSync(p));
  const r = await kjorJobb({
    jobb: "Kundejobb hvit folie",
    folie: { kode: "751-010", hex: "#FFFFFF" },
    linjer: [
      { navn: "Gabben Alversund", pdf: les("/home/claude/kunde/Gabben_Alversund.pdf"), breddeMm: 250, antall: 10 },
      { navn: "Hagel", pdf: les("hagel_outlined.pdf"), breddeMm: 100, antall: 15 },
      { navn: "Klinikk Sætran", pdf: les("/home/claude/kunde/Klinikk_S_tran.pdf"), breddeMm: 600, antall: 6 },
      { navn: "Mundal Subsea", pdf: les("/home/claude/kunde/Mundal_Subsea.pdf"), breddeMm: 900, antall: 7 },
      { navn: "OH Betong", pdf: les("/home/claude/kunde/OH_Betong.pdf"), breddeMm: 400, antall: 12 },
      { navn: "Truck Agent Bergen", pdf: les("/home/claude/kunde/Truck_Agent_Bergen.pdf"), breddeMm: 300, antall: 10 },
    ],
    felt: {
      kundenavn: "Testkunde AS", kundenummer: "10442", ordrenummer: "T-2026-0181",
      deresKontakt: "Ola Nordmann", varKontakt: "Eirik", korrekturdato: "14.08.2026",
    },
    bilder: {
      disclaimer: await loadImage(Buffer.from(DISCLAIMER.split(",")[1], "base64")),
      vannmerke: await loadImage(Buffer.from(VANNMERKE.split(",")[1], "base64")),
    },
    lerret: (b, h) => createCanvas(Math.round(b), Math.round(h)) as any,
  });

  console.log("ANALYSE");
  console.log("  motiv                 bredde   hoyde  flater  hull  omkrets   areal    O/A  tynneste  status");
  for (const a of r.analyse) {
    console.log(`  ${a.navn.padEnd(20)} ${a.breddeMm.toFixed(0).padStart(6)} ` +
      `${a.hoydeMm.toFixed(1).padStart(7)} ${String(a.flater).padStart(7)} ` +
      `${String(a.hull).padStart(5)} ${(a.omkretsMm / 10).toFixed(1).padStart(8)} ` +
      `${a.arealCm2.toFixed(1).padStart(7)} ${a.oa.toFixed(2).padStart(6)} ` +
      `${a.tynnesteMm.toFixed(2).padStart(9)}  ${a.status}`);
  }
  for (const k of r.ark) {
    console.log(`\nARK ${k.foliekode}  ${k.breddeMm} x ${k.lengdeMm.toFixed(1)} mm = ` +
      `${k.kvadratmeter.toFixed(3)} m2 | ${k.elementer} elementer ` +
      `(${k.roterte} roterte) | ${k.regmarkSett} regmark-sett`);
  }

  console.log("\nFILER");
  for (const f of r.filer) {
    fs.writeFileSync("ut_" + f.navn, f.bytes);
    console.log(`  ${f.slag.padEnd(12)} ${f.navn.padEnd(48)} ${Math.round(f.bytes.length / 1024)} kB`);
  }
  console.log("\nADVARSLER");
  for (const a of r.advarsler) console.log("  " + a);
})();
