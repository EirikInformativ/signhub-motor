/*
 * Saethre ID.Buzz (305007): feltene Eirik har godkjent er laast.
 *
 * Fasit i saethre_fasit.json er tatt fra versjonen han godkjente
 * 19.11.2026 (bilde 10 og 11). Endrer motoren et laast felt, feiler testen.
 * Nye felt legges til fasiten naar Eirik godkjenner dem.
 *
 *   hjorne_foran  side 1, hjoernet foran fra grillen til hjulbuen. IoU >= 0,93.
 *   hjorne_bak    side 1, hjoernet bak bakhjulet. Hele fasiten dekket (97 %),
 *                 og hoeyst 25 % stoerre: Eirik vil at det ogsaa eier biten
 *                 inne i hjulbuen.
 *   speilbilde    det samme feltet paa side 2 er speilbildet (IoU >= 0,85).
 *   stripene      de graa stripene deler det oransje feltet: tre stykker
 *                 mellom hjulene paa side 1 (godkjent 18.11.2026).
 *
 * Kjoeres fra test/: npx tsx saethre.ts
 */
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { lesBilskisse, DISCLAIMER, VANNMERKE } from "../src/motor";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import * as pcMod from "polygon-clipping";
const pc: any = (pcMod as any).default ?? pcMod;

const K = (25.4 / 72) * 30; // skissepunkter til mm i full stoerrelse
const PX = 150 / 72; // skissepunkter til piksler (bare til meldinger)
type Ring = [number, number][];
const areal = (mp: any) => {
  let a = 0;
  for (const poly of mp) poly.forEach((r: Ring, i: number) => {
    let s = 0;
    for (let k = 0; k < r.length - 1; k++) s += r[k][0] * r[k + 1][1] - r[k + 1][0] * r[k][1];
    a += (i ? -1 : 1) * Math.abs(s / 2);
  });
  return a;
};
const lukk = (r: Ring): Ring => (r[0][0] === r[r.length - 1][0] && r[0][1] === r[r.length - 1][1] ? r : [...r, r[0]]);
const mp = (r: Ring) => [[lukk(r)]];
const snitt = (a: any, b: any) => { try { return areal(pc.intersection(a, b)); } catch { return 0; } };
const boks = (r: Ring) => ({ x0: Math.min(...r.map((q) => q[0])), y0: Math.min(...r.map((q) => q[1])), x1: Math.max(...r.map((q) => q[0])), y1: Math.max(...r.map((q) => q[1])) });

let feil = 0;
const sjekk = (ok: boolean, tekst: string) => { console.log((ok ? "OK    " : "FEIL  ") + tekst); if (!ok) feil++; };

(async () => {
  const fasit = JSON.parse(fs.readFileSync("saethre_fasit.json", "utf8"));
  const ut = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "saethre-")), "felt.json");
  process.env.FELT_JSON = ut;
  await lesBilskisse(new Uint8Array(fs.readFileSync("saethre.pdf")), {
    jobb: "saethre",
    bilder: { disclaimer: await loadImage(DISCLAIMER), vannmerke: await loadImage(VANNMERKE) },
    lerret: (b: number, h: number) => createCanvas(Math.round(b), Math.round(h)),
  } as any);
  delete process.env.FELT_JSON;
  const stykker: { vis: string; navn: string; r: Ring }[] = [];
  for (const l of fs.readFileSync(ut, "utf8").split("\n").filter(Boolean)) {
    const o = JSON.parse(l);
    if (o.hex !== "#B12000") continue;
    for (const r of o.baner as Ring[]) {
      if (r.length < 3 || areal(mp(r)) * K * K < 20000) continue;
      stykker.push({ vis: String(o.navn).split(" dekor")[0], navn: o.navn, r });
    }
  }
  const best = (f: Ring, vis: string) => stykker.filter((s) => s.vis === vis)
    .map((s) => ({ s, inn: snitt(mp(f), mp(s.r)) }))
    .sort((a, b) => b.inn - a.inn)[0];

  // hjoernet foran
  {
    const f: Ring = fasit.hjorne_foran.form;
    const b = best(f, "side 1");
    const iou = b ? b.inn / (areal(mp(f)) + areal(mp(b.s.r)) - b.inn) : 0;
    sjekk(iou >= 0.93, `hjoernet foran (side 1) som godkjent: IoU ${iou.toFixed(2)} (krav 0,93)`);
  }
  // hjoernet bak
  {
    const f: Ring = fasit.hjorne_bak.form;
    const b = best(f, "side 1");
    const af = areal(mp(f));
    const dekket = b ? b.inn / af : 0, stor = b ? areal(mp(b.s.r)) / af : 0;
    sjekk(dekket >= 0.97 && stor <= 1.25, `hjoernet bak (side 1) som godkjent: ${(dekket * 100).toFixed(0)} % dekket (krav 97), ${(stor * 100).toFixed(0)} % av fasit (krav hoeyst 125)`);
  }
  // speilbildet paa side 2
  for (const navn of ["hjorne_foran", "hjorne_bak"]) {
    const f: Ring = fasit[navn].form;
    const s1 = best(f, "side 1");
    if (!s1) { sjekk(false, `${navn}: fant ikke feltet paa side 1`); continue; }
    const b1 = boks(s1.s.r);
    let beste = 0;
    for (const s of stykker.filter((x) => x.vis === "side 2")) {
      const b2 = boks(s.r);
      const speil = s.r.map(([x, y]) => [b1.x0 + (b2.x1 - x), b1.y0 + (y - b2.y0)] as [number, number]);
      const inn = snitt(mp(s1.s.r), mp(speil));
      const iou = inn / (areal(mp(s1.s.r)) + areal(mp(speil)) - inn);
      if (iou > beste) beste = iou;
    }
    sjekk(beste >= 0.85, `${navn}: side 2 er speilbildet av side 1, IoU ${beste.toFixed(2)} (krav 0,85)`);
  }
  // stripene deler feltet mellom hjulene
  {
    const mellom = stykker.filter((s) => s.vis === "side 1" && areal(mp(s.r)) * K * K > 250000 && boks(s.r).x0 * PX > 250 && boks(s.r).x1 * PX < 1000);
    sjekk(mellom.length >= 3, `stripene deler feltet mellom hjulene paa side 1: ${mellom.length} stykker (krav minst 3)`);
  }
  console.log(feil ? `\n${feil} feil` : "\nalt laast felt staar");
  process.exit(feil ? 1 : 0);
})();
