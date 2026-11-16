/**
 * Dekor under bilens egne deler (Eirik 16.11.2026).
 *
 * En stripe 1000 x 40 (tegnede enheter = mm her) med en bildel tegnet oppaa
 * enden:
 *  - bildelen dekker 200 mm: stripen kuttes 50 mm inn under den
 *  - bildelen dekker 5 mm: stripen forlenges til 50 mm inn under den,
 *    uten aa bli tykkere
 */
import { kuttVedBildeler, ringerAv } from "../src/klippkant.ts";
import type { Bane } from "../src/uttrekk.ts";
import * as pcModul from "polygon-clipping";
const pc: any = (pcModul as any).default ?? pcModul;

let feil = 0;
const sjekk = (ok: boolean, t: string) => { console.log(`${ok ? "ok  " : "FEIL"} ${t}`); if (!ok) feil++; };

const rekt = (x0: number, y0: number, x1: number, y1: number, farge: number[]): Bane => ({
  segs: [{ t: "m", p: [x0, y0] }, { t: "l", p: [x1, y0] }, { t: "l", p: [x1, y1] }, { t: "l", p: [x0, y1] }, { t: "h" }] as any,
  farge, strekFarge: farge, fyll: true, strek: false, bredde: 0, boks: { x0, y0, x1, y1 },
});
const GRONN = [1, 0, 0.55, 0.29], GRAA = [0, 0, 0, 0.9];
const boks = (b: Bane) => {
  const p = ringerAv(b.segs as any).flat();
  return { x0: Math.min(...p.map((q) => q[0])), x1: Math.max(...p.map((q) => q[0])),
           y0: Math.min(...p.map((q) => q[1])), y1: Math.max(...p.map((q) => q[1])) };
};

// 1. bildelen dekker 200 mm av enden: kuttes til 50 mm under den
{
  const stripe = rekt(0, 0, 1000, 40, GRONN);
  const bue = rekt(800, -100, 1300, 200, GRAA);
  const r = kuttVedBildeler([stripe], [stripe, bue], (b) => b === stripe, 50, 20);
  const b = boks(r.baner[0]);
  sjekk(Math.abs(b.x1 - 850) < 1, `lang ende kuttes 50 mm inn under bildelen (slutter paa ${b.x1.toFixed(1)})`);
  sjekk(b.x0 === 0 && Math.abs(b.y1 - 40) < 0.01, "det som synes, er urort");
}
// 2. bildelen dekker bare 5 mm: forlenges til 50 mm, like hoey
{
  const stripe = rekt(0, 0, 1000, 40, GRONN);
  const bue = rekt(995, -100, 1300, 200, GRAA);
  const r = kuttVedBildeler([stripe], [stripe, bue], (b) => b === stripe, 50, 20);
  const b = boks(r.baner[0]);
  sjekk(r.forlenget === 1, "kort ende forlenges");
  sjekk(Math.abs(b.x1 - 1045) < 1, `forlenget til 50 mm inn under bildelen (slutter paa ${b.x1.toFixed(1)})`);
  sjekk(b.y0 > -0.01 && b.y1 < 40.01, `stripen blir ikke tykkere (${b.y0.toFixed(2)} til ${b.y1.toFixed(2)})`);
  sjekk(!r.kortForbi.length, "ingen melding om for kort naar den er forlenget");
}
// 3. en smal synlig glippe (6 mm) er en knott: den styrer ikke kuttet, og
//    kuttlinjen blir rett (Eirik 16.11.2026: «bein i toppen»)
{
  const stripe = rekt(0, 0, 400, 300, GRONN);
  const del1 = rekt(-10, 100, 197, 400, GRAA);
  const del2 = rekt(203, 100, 410, 400, GRAA);
  const tak = rekt(-10, 140, 410, 400, GRAA);   // glippa er bare 40 mm hoey
  const r = kuttVedBildeler([stripe], [stripe, del1, del2, tak], (b) => b === stripe, 50, 20);
  const b = boks(r.baner[0]);
  sjekk(r.knotter === 1, "knotten meldes");
  sjekk(Math.abs(b.y1 - 150) < 0.5, `rett kutt 50 mm over det synlige, ingen tapp (topp ${b.y1.toFixed(1)})`);
}
// 4. en ekte synlig del (60 mm bred) er ikke en knott og blir staaende
{
  const stripe = rekt(0, 0, 400, 300, GRONN);
  const del1 = rekt(-10, 100, 170, 400, GRAA);
  const del2 = rekt(230, 100, 410, 400, GRAA);
  const r = kuttVedBildeler([stripe], [stripe, del1, del2], (b) => b === stripe, 50, 20);
  sjekk(r.knotter === 0 && boks(r.baner[0]).y1 > 299, "en 60 mm bred synlig del er dekor og staar");
}
// 5. kuttlinjen er rett: en skraa bildel over en bred flate gir en rett kant
{
  const flate = rekt(0, 0, 600, 300, GRONN);
  // et V-formet hakk i det synlige (dekket ovenfra med to skraa deler)
  const v1: Bane = { ...rekt(0, 0, 1, 1, GRAA), segs: [{ t: "m", p: [-10, 200] }, { t: "l", p: [300, 150] }, { t: "l", p: [300, 400] }, { t: "l", p: [-10, 400] }, { t: "h" }] as any, boks: { x0: -10, y0: 150, x1: 300, y1: 400 } };
  const v2: Bane = { ...rekt(0, 0, 1, 1, GRAA), segs: [{ t: "m", p: [300, 150] }, { t: "l", p: [610, 200] }, { t: "l", p: [610, 400] }, { t: "l", p: [300, 400] }, { t: "h" }] as any, boks: { x0: 300, y0: 150, x1: 610, y1: 400 } };
  const r = kuttVedBildeler([flate], [flate, v1, v2], (b) => b === flate, 50, 20);
  const fl = (bn: Bane) => ringerAv(bn.segs as any).map((rr) => [[...rr, rr[0]]]);
  const prove = (x: number, y: number) => pc.intersection(fl(r.baner[0]) as any, [[[[x - 1, y - 1], [x + 1, y - 1], [x + 1, y + 1], [x - 1, y + 1], [x - 1, y - 1]]]] as any).length > 0;
  // det synlige er hoeyest 200 ved kantene og 150 i midten; rett kutt ligger paa 250 hele veien
  sjekk(prove(300, 240) && prove(20, 240) && prove(580, 240), "kuttlinjen er rett, ingen dupp der de to delene moetes");
}

if (feil) { console.log(`\n${feil} feil`); process.exit(1); }
console.log("\nok: kuttet og forlengelsen under bildelene holder");
