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
 *  - teksten, A-en og stripen ble ett element paa 2947 x 817 mm, nesten bare
 *    luft (Eirik: tekst og striper skal skjaeres hver for seg).
 *
 * Fasit: 10 elementer, ett meldt som samme merke (panseret). Bare gronn
 * og sort. ÅTG i 3 eksemplarer med sort over 75 %. A-en med trekant (2 stk),
 * stripen alene (2 stk), «RØR - ELEKTRO - ENERGI» for seg, og bak er
 * stripen, «åtg.no» og «- RØR» tre deler.
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
  sjekk(l.elementer.length === 10, `10 elementer (fikk ${l.elementer.length})`);
  sjekk(l.elementer.filter((e) => e.sammeSom).length === 1, "panseret meldt som samme merke");
  const fremmed = l.elementer.filter((e) => e.farger.some((f) => f.hex !== GRONN && f.hex !== SORT));
  sjekk(!fremmed.length, `bare gronn og sort, ingen bildeler (${fremmed.map((e) => e.navn + ": " + e.farger.map((f) => f.hex).join(" ")).join("; ")})`);
  const atg = l.elementer.find((e) => e.antall === 3);
  const sortAndel = atg?.farger.find((f) => f.hex === SORT)?.andel ?? 0;
  sjekk(!!atg && sortAndel > 0.75, `ÅTG i 3 eksemplarer med sorte bokstaver og ring (sort ${(sortAndel * 100).toFixed(0)} %)`);
  const stor = l.elementer.filter((e) => e.breddeMm > 1000 && e.hoydeMm > 300);
  sjekk(!stor.length, `ingen store elementer med luft (${stor.map((e) => e.breddeMm + " x " + e.hoydeMm).join(", ")})`);
  const stripe = l.elementer.find((e) => e.breddeMm > 2400 && e.hoydeMm < 150 && e.antall === 2);
  sjekk(!!stripe && stripe.farger.length === 1, "den lange stripen er egen del, 2 stk, bare gronn");
  const a = l.elementer.find((e) => e.antall === 2 && e.hoydeMm > 600);
  sjekk(!!a && a.farger.length === 2, "A-en med gronn trekant er egen del, 2 stk");
  const tekst = l.elementer.filter((e) => e.breddeMm > 1150 && e.breddeMm < 1300 && e.farger.length === 1 && e.farger[0].hex === SORT);
  sjekk(tekst.length === 2, `«RØR - ELEKTRO - ENERGI» for seg paa begge sider (${tekst.length})`);
  const bakSort = l.elementer.filter((e) => /ende hoyre dekor 2 del/.test(e.navn) && e.farger[0].hex === SORT);
  sjekk(bakSort.length === 2, `bak: «åtg.no» og «- RØR» hver for seg (${bakSort.length})`);
  if (feil) { console.log(`\n${feil} feil`); process.exit(1); }
  console.log("\nok: Kia PV5 leses riktig");
})();
