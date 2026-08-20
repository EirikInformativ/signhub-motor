/**
 * Snur staaende motiver opp i skissen.
 *
 * Et element som sitter langs taket eller nedover en dor, er tegnet
 * liggende paa siden i kildefila. Kunden skal lese logoen, ikke legge
 * hodet paa skakke, sa i skissen snus den opp.
 *
 * Hvilken vei den skal snus, gjetter vi ikke paa naar vi kan vite det:
 * er samme logo med i jobben i riktig stilling et annet sted, snur vi
 * den veien som gjor at de to ser like ut. Finnes ingen tvilling, snur
 * vi med klokka, som er den vanlige maaten a sette tekst staaende paa.
 */
import type { SkisseMotiv } from "./skisselayout.ts";
import type { MultiPoly } from "./pdfbaner.ts";

const RUTER = 24;
const GODKJENT = 0.55;

const snuFlate = (mp: MultiPoly, medKlokka: boolean): MultiPoly =>
  mp.map((poly) => poly.map((ring) =>
    ring.map(([x, y]) => (medKlokka ? [y, -x] : [-y, x]) as [number, number])));

function nyBoks(mp: MultiPoly): [number, number, number, number] {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const poly of mp) for (const ring of poly) for (const [x, y] of ring) {
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  return [x0, y0, x1, y1];
}

/** Grovt avtrykk av formen, strukket til et kvadrat sa storrelsen ikke teller. */
function avtrykk(mp: MultiPoly, boks: [number, number, number, number]): Uint8Array {
  const g = new Uint8Array(RUTER * RUTER);
  const b = Math.max(boks[2] - boks[0], 1e-9), h = Math.max(boks[3] - boks[1], 1e-9);
  for (const poly of mp) for (const ring of poly) for (const [x, y] of ring) {
    const i = Math.min(RUTER - 1, Math.max(0, Math.floor(((x - boks[0]) / b) * RUTER)));
    const j = Math.min(RUTER - 1, Math.max(0, Math.floor(((y - boks[1]) / h) * RUTER)));
    g[j * RUTER + i] = 1;
  }
  return g;
}

function likhet(a: Uint8Array, b: Uint8Array): number {
  let felles = 0, samlet = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] && b[i]) felles++;
    if (a[i] || b[i]) samlet++;
  }
  return samlet ? felles / samlet : 0;
}

function snuMotiv(m: SkisseMotiv, medKlokka: boolean): SkisseMotiv {
  const flate = snuFlate(m.flate, medKlokka);
  const boks = nyBoks(flate);
  const forhold = m.breddeMm > 0 ? m.hoydeMm / m.breddeMm : 1;
  return {
    ...m,
    flate,
    bbox: boks,
    breddeMm: m.hoydeMm,
    hoydeMm: m.breddeMm,
    minBreddeMm: m.minBreddeMm * forhold,
    deler: m.deler?.map((d) => ({ ...d, flate: snuFlate(d.flate, medKlokka) })),
  };
}

/** Returnerer motivene med staaende elementer snudd opp. */
export function snuOpp(motiver: SkisseMotiv[]): SkisseMotiv[] {
  const liggende = motiver.filter((m) => m.breddeMm > m.hoydeMm);
  const merker = liggende.map((m) => avtrykk(m.flate, m.bbox));
  return motiver.map((m) => {
    if (m.hoydeMm <= m.breddeMm * 1.05) return m;
    let besteVei = true, beste = 0;
    for (const medKlokka of [true, false]) {
      const kandidat = snuMotiv(m, medKlokka);
      const merke = avtrykk(kandidat.flate, kandidat.bbox);
      for (const annet of merker) {
        const s = likhet(merke, annet);
        if (s > beste) { beste = s; besteVei = medKlokka; }
      }
    }
    return snuMotiv(m, beste >= GODKJENT ? besteVei : true);
  });
}
