/**
 * Finner dekoren i en bilskisse uten at noen peker den ut.
 *
 * Reglene, i den rekkefolgen de virker:
 *
 *  1. Bilen er tegnet i gratoner. Alt som har kulor er en kandidat.
 *  2. Skissen har sine egne kulorer: malpiler, hjelpelinjer og lykter.
 *     De kjennes igjen ved at fargen ogsa brukes til harstrek, altsa en
 *     strek som er under 3 mm i virkeligheten og mer enn tretti ganger
 *     sa lang som den er bred. Ingen legger folie i den formen. En farge
 *     som opptrer slik, er skissens egen og ikke kundens.
 *  3. Det som ligger utenfor visningene er arkinformasjon, ikke dekor.
 *  4. Resten samles i klynger. En klynge er ett dekorelement.
 *  5. Hvite og svarte deler av logoen har ingen kulor, sa de fanges til
 *     slutt ved at de ligger inne i klyngens ramme.
 */
import type { Boks, LettLest } from "./bilskisse.ts";

const MM = 72 / 25.4;

const HARSTREK_MM = 0.1;      // tegnet tykkelse
const HARSTREK_FORHOLD = 30;
const KLYNGE_MM = 3;          // tegnet glippe innenfor ett element
const MINSTE_EKTE_MM = 30;    // mindre enn dette er ikke folie

export interface DekorOmraade {
  x0: number; y0: number; x1: number; y1: number;
  vis: string; navn: string;
  bokser: number;
  farger: string[];
  breddeEkteMm: number; hoydeEkteMm: number;
  sikkerhet: "sikker" | "tvil";
}

export interface Visning {
  x0: number; y0: number; x1: number; y1: number;
  navn: string; breddeEkteMm: number; hoydeEkteMm: number;
}

export interface DekorFunn {
  visninger: Visning[];
  omraader: DekorOmraade[];
  forkastet: { hva: string; grunn: string }[];
  merknader: string[];
}

const ramme = (bs: Boks[]): Boks => ({
  x0: Math.min(...bs.map((b) => b.x0)), y0: Math.min(...bs.map((b) => b.y0)),
  x1: Math.max(...bs.map((b) => b.x1)), y1: Math.max(...bs.map((b) => b.y1)),
});

const kulor = (b: Boks) => !!b.farge && Math.max(b.farge[0], b.farge[1], b.farge[2]) >= 0.05;
const fargenavn = (b: Boks) => (b.farge ?? []).map((x) => x.toFixed(2)).join(",");

/** Klynger bokser som ligger naermere hverandre enn glippe. */
function klynger(bs: Boks[], glippe: number): Boks[][] {
  const p = bs.map((_, i) => i);
  const f = (i: number): number => (p[i] === i ? i : (p[i] = f(p[i])));
  const av = (a: Boks, b: Boks) => Math.hypot(
    Math.max(0, Math.max(a.x0 - b.x1, b.x0 - a.x1)),
    Math.max(0, Math.max(a.y0 - b.y1, b.y0 - a.y1)));
  for (let i = 0; i < bs.length; i++)
    for (let j = i + 1; j < bs.length; j++)
      if (av(bs[i], bs[j]) <= glippe) p[f(i)] = f(j);
  const m = new Map<number, Boks[]>();
  bs.forEach((b, i) => { const r = f(i); if (!m.has(r)) m.set(r, []); m.get(r)!.push(b); });
  return [...m.values()];
}

const andelInni = (b: Boks, o: Boks) => {
  const ox = Math.max(0, Math.min(b.x1, o.x1) - Math.max(b.x0, o.x0));
  const oy = Math.max(0, Math.min(b.y1, o.y1) - Math.max(b.y0, o.y0));
  return (ox * oy) / Math.max((b.x1 - b.x0) * (b.y1 - b.y0), 1e-9);
};

/** Visningene pa arket, navngitt ved hjelp av malene i teksten. */
/**
 * Visninger ligger i rader og kolonner med hvitt imellom. Vi leter etter
 * det hvite: rader uten blekk deler arket i band, kolonner uten blekk
 * deler et band i visninger. Det er sikrere enn a male avstand mellom
 * bokser, for en enkelt bokelig ramme kan spenne over mye tomrom.
 */
function profilDel(bokser: Boks[], vannrett: boolean, glippe: number): Boks[][] {
  if (!bokser.length) return [];
  const lo = Math.min(...bokser.map((b) => (vannrett ? b.y0 : b.x0)));
  const hi = Math.max(...bokser.map((b) => (vannrett ? b.y1 : b.x1)));
  const n = Math.max(1, Math.ceil((hi - lo) / glippe));
  const blekk = new Uint8Array(n + 1);
  for (const b of bokser) {
    const a = Math.floor(((vannrett ? b.y0 : b.x0) - lo) / glippe);
    const z = Math.ceil(((vannrett ? b.y1 : b.x1) - lo) / glippe);
    for (let i = Math.max(0, a); i <= Math.min(n, z); i++) blekk[i] = 1;
  }
  const kant: [number, number][] = [];
  let start = -1;
  for (let i = 0; i <= n; i++) {
    if (blekk[i] && start < 0) start = i;
    else if (!blekk[i] && start >= 0) { kant.push([lo + start * glippe, lo + i * glippe]); start = -1; }
  }
  if (start >= 0) kant.push([lo + start * glippe, hi]);
  return kant.map(([a, z]) => bokser.filter((b) => {
    const m = vannrett ? (b.y0 + b.y1) / 2 : (b.x0 + b.x1) / 2;
    return m >= a && m <= z;
  })).filter((g) => g.length);
}

export function finnVisninger(bokser: Boks[], malestokk: number,
                              dim: { L: number | null; B: number | null; H: number | null }): Visning[] {
  const grupper = profilDel(bokser, true, 2 * MM)
    .flatMap((band) => profilDel(band, false, 2 * MM))
    .map((g) => ramme(g))
    .filter((r) => (r.x1 - r.x0) / MM > 20 && (r.y1 - r.y0) / MM > 20)
    .sort((a, b) => b.y1 - a.y1);

  const naer = (x: number, y: number) => Math.abs(x / y - 1) <= 0.3;
  const rader: Visning[] = grupper.map((r) => ({
    ...r, navn: "visning",
    breddeEkteMm: ((r.x1 - r.x0) / MM) * malestokk,
    hoydeEkteMm: ((r.y1 - r.y0) / MM) * malestokk,
  }));

  /**
   * En skisse har tre visninger pa langs (topp og to sider) og to i enden.
   * Topp og side er like lange, sa lengden skiller dem ikke. Men de to
   * sidene er like hoye, og toppen er den som blir til overs. Det er
   * sikrere enn a sammenligne med bredde og hoyde, for pa en varebil er
   * bredden og hoyden nesten like store.
   */
  const langs = dim.L ? rader.filter((v) => naer(v.breddeEkteMm / 1000, dim.L!)) : [];
  const ender = rader.filter((v) => !langs.includes(v));

  if (langs.length >= 3) {
    let beste: [Visning, Visning] | null = null, minst = Infinity;
    for (let i = 0; i < langs.length; i++) for (let j = i + 1; j < langs.length; j++) {
      const d = Math.abs(langs[i].hoydeEkteMm - langs[j].hoydeEkteMm);
      if (d < minst) { minst = d; beste = [langs[i], langs[j]]; }
    }
    const sider = (beste ?? []).slice().sort((x, y) => y.y1 - x.y1);
    sider.forEach((v, i) => { v.navn = i === 0 ? "side ovre" : "side nedre"; });
    for (const v of langs) if (!sider.includes(v)) v.navn = "topp";
  } else {
    for (const v of langs) {
      v.navn = dim.B && dim.H
        ? (Math.abs(v.hoydeEkteMm / 1000 - dim.B) < Math.abs(v.hoydeEkteMm / 1000 - dim.H) ? "topp" : "side")
        : "langs";
    }
  }
  const sortert = ender.slice().sort((x, y) => x.x0 - y.x0);
  sortert.forEach((v, i) => {
    v.navn = sortert.length === 2 ? (i === 0 ? "ende venstre" : "ende hoyre") : `ende ${i + 1}`;
  });

  // nummerer eventuelle gjengangere slik at navnene er entydige
  const teller = new Map<string, number>(), antall = new Map<string, number>();
  for (const v of rader) antall.set(v.navn, (antall.get(v.navn) ?? 0) + 1);
  for (const v of rader) {
    if ((antall.get(v.navn) ?? 0) < 2) continue;
    const n = (teller.get(v.navn) ?? 0) + 1;
    teller.set(v.navn, n);
    v.navn = `${v.navn} ${n}`;
  }
  return rader;
}

export function finnDekor(lest: LettLest, malestokk: number,
                          dim: { L: number | null; B: number | null; H: number | null }): DekorFunn {
  const merknader: string[] = [];
  const forkastet: { hva: string; grunn: string }[] = [];

  const kulorte = lest.bokser.filter(kulor);

  // 2. skissens egne farger: de som ogsa brukes til harstrek.
  //    Dette ma gjores forst, for malpilene binder visningene sammen
  //    til en klump hvis de far vaere med naar visningene skal finnes.
  const malfarge = new Set<string>();
  for (const b of kulorte) {
    const w = (b.x1 - b.x0) / MM, h = (b.y1 - b.y0) / MM;
    const t = Math.min(w, h), L = Math.max(w, h);
    if (t < HARSTREK_MM && L / Math.max(t, 1e-9) > HARSTREK_FORHOLD) malfarge.add(fargenavn(b));
  }
  if (malfarge.size) merknader.push(
    `Skissens egne farger (brukt til malpiler og hjelpelinjer): ${[...malfarge].join(" og ")}.`);

  const rene = lest.bokser.filter((b) => !malfarge.has(fargenavn(b)));
  const visninger = finnVisninger(rene, malestokk, dim);

  if (!kulorte.length) {
    merknader.push("Skissen har ingen kulorte flater. Enten er den umalt, " +
      "eller sa er dekoren i sort og hvitt. Da ma dekoren merkes for hand.");
    return { visninger, omraader: [], forkastet, merknader };
  }

  const iVisning = (b: Boks) => visninger.some((v) => andelInni(b, v) >= 0.5);
  const kandidater = kulorte.filter((b) => {
    if (malfarge.has(fargenavn(b))) return false;
    if (!iVisning(b)) return false;
    return true;
  });
  const fjernetFarge = kulorte.filter((b) => malfarge.has(fargenavn(b))).length;
  if (fjernetFarge) forkastet.push({ hva: `${fjernetFarge} flater`, grunn: "skissens egne farger" });
  const utenfor = kulorte.filter((b) => !malfarge.has(fargenavn(b)) && !iVisning(b)).length;
  if (utenfor) forkastet.push({ hva: `${utenfor} flater`, grunn: "ligger utenfor visningene" });

  // 4. klynger, en klynge er ett element
  const omraader: DekorOmraade[] = [];
  for (const g of klynger(kandidater, KLYNGE_MM * MM)) {
    let r = ramme(g);
    const bE = ((r.x1 - r.x0) / MM) * malestokk;
    const hE = ((r.y1 - r.y0) / MM) * malestokk;
    if (bE < MINSTE_EKTE_MM && hE < MINSTE_EKTE_MM) {
      forkastet.push({ hva: `${g.length} flater ved x${(r.x0 / MM).toFixed(0)} y${(r.y0 / MM).toFixed(0)}`,
        grunn: `bare ${bE.toFixed(0)} x ${hE.toFixed(0)} mm i virkeligheten` });
      continue;
    }
    // 5. hvite og sorte deler av samme logo
    let med = g.slice();
    for (let runde = 0; runde < 3; runde++) {
      const pad = { x0: r.x0 - 1 * MM, y0: r.y0 - 1 * MM, x1: r.x1 + 1 * MM, y1: r.y1 + 1 * MM };
      const nye = lest.bokser.filter((b) => !med.includes(b) && andelInni(b, pad) >= 0.9);
      if (!nye.length) break;
      med = med.concat(nye);
      r = ramme(med);
    }
    const v = visninger.find((vv) => andelInni(r, vv) >= 0.5);
    omraader.push({
      ...r, vis: v?.navn ?? "ukjent", navn: "dekor",
      bokser: med.length,
      farger: [...new Set(med.filter(kulor).map(fargenavn))],
      breddeEkteMm: ((r.x1 - r.x0) / MM) * malestokk,
      hoydeEkteMm: ((r.y1 - r.y0) / MM) * malestokk,
      sikkerhet: "sikker",
    });
  }

  // nummerer per visning
  const n = new Map<string, number>();
  for (const o of omraader.sort((a, b) => b.y1 - a.y1 || a.x0 - b.x0)) {
    const i = (n.get(o.vis) ?? 0) + 1;
    n.set(o.vis, i);
    o.navn = `dekor ${i}`;
  }
  if (!omraader.length) merknader.push("Fant ingen dekor. Skissen ma merkes for hand.");
  return { visninger, omraader, forkastet, merknader };
}
