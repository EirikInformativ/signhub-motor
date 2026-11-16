/**
 * Rammer som foelger formen, med rett bunn (Eirik 16.11.2026).
 *
 * Et stort triangel (1000 x 500 mm, spissen opp) og fire kvadrater paa
 * 150 mm. Med rektangulaere rammer maa kvadratene under triangelet, og
 * arket blir rundt 680 mm. Med formede rammer faller de ned i hjoernene ved
 * siden av skraakantene, og arket blir like langt som triangelet.
 *
 * Sjekker ogsaa at bunnen er rett (hele bredden, i elementets egen
 * retning), at kiss-boksen ligger utenfor rammen, og at ingen rammer
 * kommer naermere hverandre enn gapet.
 */
import { pakkFritt } from "../src/pakk.ts";
import { STD_GEO, MM } from "../src/produksjonsfil.ts";
import type { Motiv } from "../src/produksjonsfil.ts";
import * as pcModul from "polygon-clipping";
const pc: any = (pcModul as any).default ?? pcModul;

let feil = 0;
const sjekk = (ok: boolean, tekst: string) => { console.log(`${ok ? "ok  " : "FEIL"} ${tekst}`); if (!ok) feil++; };

const motiv = (navn: string, ring: [number, number][], antall: number): Motiv => {
  const xs = ring.map((p) => p[0]), ys = ring.map((p) => p[1]);
  const bbox: [number, number, number, number] = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  return { navn, flate: [], bbox, skala: MM, breddeMm: bbox[2] - bbox[0], hoydeMm: bbox[3] - bbox[1], antall,
    omriss: [[[...ring, ring[0]]]] };
};
const tri = motiv("triangel", [[0, 0], [1000, 0], [500, 500]], 1);
const kv = motiv("kvadrat", [[0, 0], [150, 0], [150, 150], [0, 150]], 4);
const geo = { ...STD_GEO, foliebredde: 1260, skjaerebredde: 1215 };

const formet = pakkFritt([tri, kv], geo);
const rekt = pakkFritt([{ ...tri, omriss: undefined }, { ...kv, omriss: undefined }], geo);
console.log(`rektangler ${rekt.arklengde.toFixed(0)} mm, formede ${formet.arklengde.toFixed(0)} mm (${formet.strategi})`);
sjekk(/formede rammer/.test(formet.strategi), "formede rammer velges naar de gir kortere ark");
sjekk(formet.arklengde < rekt.arklengde - 100, "kvadratene faller ned ved siden av skraakantene");
sjekk(!formet.feil.length, `ingen rammer naermere hverandre enn gapet (${formet.feil.join(" ")})`);

for (const p of formet.plasseringer) {
  const r = p.ramme!;
  // bunnen: i elementets retning er den nederste kanten rett og like bred som boksen
  const kant = p.rotated
    ? r.filter(([x]) => Math.abs(x - (p.x + p.w)) < 0.05).map(([, y]) => y)
    : r.filter(([, y]) => Math.abs(y - (p.y + p.h)) < 0.05).map(([x]) => x);
  const fra = p.rotated ? p.y : p.x, til = p.rotated ? p.y + p.h : p.x + p.w;
  const rett = kant.length >= 2 && Math.min(...kant) <= fra + 0.5 && Math.max(...kant) >= til - 0.5;
  sjekk(rett, `${p.id === 0 ? "triangel" : "kvadrat"}: bunnen er rett over hele bredden`);
  const utenfor = pc.difference([[[...r, r[0]]]], [[[...p.kiss!, p.kiss![0]]]]);
  sjekk(!utenfor.length, `${p.id === 0 ? "triangel" : "kvadrat"}: kiss-boksen ligger utenfor rammen`);
}
// triangelet faar en skraa ramme, ikke et rektangel
const t = formet.plasseringer.find((p) => p.id === 0)!;
sjekk(t.ramme!.length >= 3 && t.ramme!.length < 12 && !t.ramme!.some(([x, y]) => Math.abs(x - t.x) < 1 && Math.abs(y - t.y) < 1),
  "triangelets ramme foelger skraakantene (ingen hjoerne oeverst til venstre)");

if (feil) { console.log(`\n${feil} feil`); process.exit(1); }
console.log("\nok: rammene foelger formen, bunnen er rett");
