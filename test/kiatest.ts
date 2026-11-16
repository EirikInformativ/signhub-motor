/**
 * Kia PV5 (310079): Pantone-dekor, sort ved siden av gronn, og bildeler
 * inne i rammen til store striper.
 *
 * Funnet 16.11.2026:
 *  - all dekor var PANTONE 7481 C via cs/scn, og motoren fant ingen dekor.
 *  - «ÅTG» kom ut som bare den gronne streken og trekanten; de sorte
 *    bokstavene og ringen i Å manglet.
 *  - stripene paa siden tok med doerhaandtak, vindu og bilens sorte
 *    kledning (graatoner og hvitt i fargelista).
 *  - «åtg.no» og «- RØR» bak (bare sort) kom ikke med.
 *
 * Fasit: 6 elementer, ett av dem meldt som samme merke (panseret).
 * Bare gronn og sort i alle. ÅTG i 3 eksemplarer med sort over 75 %.
 * Bakluken har sort med (tekstene).
 */
import * as fs from "fs";
import { lesBilskisse, DISCLAIMER, VANNMERKE } from "../src/motor";
import { createCanvas, loadImage } from "@napi-rs/canvas";

(async () => {
  const bilder = { disclaimer: await loadImage(DISCLAIMER), vannmerke: await loadImage(VANNMERKE) } as any;
  const lerret = (b: number, h: number) => createCanvas(Math.round(b), Math.round(h)) as any;
  let feil = 0;
  const sjekk = (ok: boolean, t: string) => { console.log(`${ok ? "ok  " : "FEIL"} ${t}`); if (!ok) feil++; };
  const l = await lesBilskisse(new Uint8Array(fs.readFileSync("kia.pdf")), { jobb: "kia", bilder, lerret });
  const GRONN = "#00B528", SORT = "#000000";
  sjekk(l.elementer.length === 6, `6 elementer (fikk ${l.elementer.length})`);
  sjekk(l.elementer.filter((e) => e.sammeSom).length === 1, "panseret meldt som samme merke");
  const fremmed = l.elementer.filter((e) => e.farger.some((f) => f.hex !== GRONN && f.hex !== SORT));
  sjekk(!fremmed.length, `bare gronn og sort, ingen bildeler (${fremmed.map((e) => e.navn + ": " + e.farger.map((f) => f.hex).join(" ")).join("; ")})`);
  const atg = l.elementer.find((e) => e.antall === 3);
  const sortAndel = atg?.farger.find((f) => f.hex === SORT)?.andel ?? 0;
  sjekk(!!atg && sortAndel > 0.75, `ÅTG i 3 eksemplarer med sorte bokstaver og ring (sort ${(sortAndel * 100).toFixed(0)} %)`);
  const bak = l.elementer.find((e) => e.breddeMm > 1400 && e.hoydeMm < 300);
  sjekk(!!bak && bak.farger.some((f) => f.hex === SORT), "bakluken har med åtg.no og - RØR i sort");
  const sider = l.elementer.filter((e) => e.breddeMm > 2500);
  sjekk(sider.length === 2 && sider.every((e) => e.breddeMm < 3200 && e.hoydeMm < 900),
    `stripene paa sidene uten bilen (${sider.map((e) => e.breddeMm + " x " + e.hoydeMm).join(", ")})`);
  if (feil) { console.log(`\n${feil} feil`); process.exit(1); }
  console.log("\nok: Kia PV5 leses riktig");
})();
