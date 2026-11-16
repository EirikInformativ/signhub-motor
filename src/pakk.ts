/**
 * Pakking av flere ulike motiver pa folierullen.
 *
 * Skiller seg fra nesting.ts ved at hvert motiv har sin egen proporsjon.
 * nesting.ts antar ett motiv i flere storrelser og brukes til forhandsvisning
 * av enkle jobber. Denne brukes nar bestillingen har ulike motiver.
 */
import type { Motiv, Ark, Plassering, Geo } from "./produksjonsfil.ts";
import { rammeLokal, profil, offsetRinger, forNaer } from "./ramme.ts";
import * as pcModul from "polygon-clipping";
const pc: any = (pcModul as any).default ?? pcModul;
import type { P } from "./ramme.ts";

interface Item { w: number; h: number; id: number; navn: string }
type Seg = { x: number; w: number; y: number };

class Skyline {
  private sky: Seg[];
  constructor(private width: number) { this.sky = [{ x: 0, w: width, y: 0 }]; }

  private nivaa(i: number, w: number): number | null {
    const x = this.sky[i].x;
    if (x + w > this.width + 1e-9) return null;
    let y = this.sky[i].y, rest = w, j = i;
    while (rest > 1e-9) {
      if (j >= this.sky.length) return null;
      y = Math.max(y, this.sky[j].y);
      rest -= this.sky[j].w;
      j++;
    }
    return y;
  }

  finn(w: number, h: number, rot: boolean) {
    let best: { top: number; x: number; y: number; r: boolean; w: number; h: number } | null = null;
    for (const r of rot ? [false, true] : [false]) {
      const ww = r ? h : w, hh = r ? w : h;
      for (let i = 0; i < this.sky.length; i++) {
        const y = this.nivaa(i, ww);
        if (y === null) continue;
        const k = { top: y + hh, x: this.sky[i].x, y, r, w: ww, h: hh };
        if (!best || k.top < best.top - 1e-9 ||
            (Math.abs(k.top - best.top) < 1e-9 && k.x < best.x - 1e-9)) best = k;
      }
    }
    return best;
  }

  legg(x: number, y: number, w: number, h: number) {
    const neste: Seg[] = [];
    for (const s of this.sky) {
      if (s.x + s.w <= x + 1e-9 || s.x >= x + w - 1e-9) { neste.push(s); continue; }
      if (s.x < x - 1e-9) neste.push({ x: s.x, w: x - s.x, y: s.y });
      if (s.x + s.w > x + w + 1e-9) neste.push({ x: x + w, w: s.x + s.w - (x + w), y: s.y });
    }
    neste.push({ x, w, y: y + h });
    neste.sort((a, b) => a.x - b.x);
    const slatt: Seg[] = [neste[0]];
    for (let i = 1; i < neste.length; i++) {
      const sist = slatt[slatt.length - 1];
      if (Math.abs(neste[i].y - sist.y) < 1e-9) sist.w += neste[i].w;
      else slatt.push(neste[i]);
    }
    this.sky = slatt;
  }
}

const STRATEGIER: { navn: string; key: (a: Item, b: Item) => number }[] = [
  { navn: "hoyde synkende", key: (a, b) => b.h - a.h || b.w - a.w },
  { navn: "bredde synkende", key: (a, b) => b.w - a.w || b.h - a.h },
  { navn: "areal synkende", key: (a, b) => b.w * b.h - a.w * a.h || b.h - a.h },
  { navn: "maks-side synkende",
    key: (a, b) => Math.max(b.w, b.h) - Math.max(a.w, a.h) || Math.min(b.w, b.h) - Math.min(a.w, a.h) },
];

function pakkEn(items: Item[], brukbar: number, gap: number, rot: boolean) {
  const sky = new Skyline(brukbar + gap);
  const ut: Plassering[] = [];
  for (const it of items) {
    const r = sky.finn(it.w + gap, it.h + gap, rot);
    if (!r) return null;
    sky.legg(r.x, r.y, r.w, r.h);
    ut.push({ x: r.x, y: r.y, w: r.w - gap, h: r.h - gap, rotated: r.r, id: it.id });
  }
  komprimer(ut, brukbar, gap, rot);
  return { ut, h: Math.max(...ut.map((p) => p.y + p.h)) };
}

/**
 * Skyline kan ikke legge noe under et element som henger over et hull
 * (Eirik 16.11.2026, Kia: «- RØR» og «åtg.no» havnet i en egen rad
 * nederst, mens det var plass oppe til hoeyre ved de to lange tekstene).
 * Etterpaa proeves hvert element, oeverst foerst, flyttet til den laveste
 * ledige plassen: i hjoernene langs kantene til de andre elementene og
 * arket, med gap. Det flyttes bare naar toppen blir lavere.
 */
function komprimer(ut: Plassering[], brukbar: number, gap: number, rot: boolean) {
  const fri = (x: number, y: number, w: number, h: number, ikke: Plassering) => {
    if (x < -1e-9 || y < -1e-9 || x + w > brukbar + 1e-6) return false;
    for (const q of ut) {
      if (q === ikke) continue;
      const dx = Math.max(x - (q.x + q.w), q.x - (x + w));
      const dy = Math.max(y - (q.y + q.h), q.y - (y + h));
      if (dx < gap - 1e-6 && dy < gap - 1e-6) return false;
    }
    return true;
  };
  for (let runde = 0; runde < 4; runde++) {
    let flyttet = false;
    for (const p of ut.slice().sort((a, b) => (b.y + b.h) - (a.y + a.h))) {
      const xs = [0, ...ut.filter((q) => q !== p).map((q) => q.x + q.w + gap)];
      const ys = [0, ...ut.filter((q) => q !== p).map((q) => q.y + q.h + gap)];
      let best: { x: number; y: number; w: number; h: number; r: boolean } | null = null;
      for (const r of rot ? [false, true] : [false]) {
        const w = r ? p.h : p.w, h = r ? p.w : p.h;
        for (const y of ys) for (const x of xs) {
          if (y + h >= (best ? best.y + best.h : p.y + p.h) - 1e-6) continue;
          if (fri(x, y, w, h, p)) best = { x, y, w, h, r };
        }
      }
      if (best) {
        p.x = best.x; p.y = best.y;
        if (best.r) { p.rotated = !p.rotated; p.w = best.w; p.h = best.h; }
        flyttet = true;
      }
    }
    if (!flyttet) break;
  }
}

export function sjekk(ps: Plassering[], brukbar: number, gap: number): string[] {
  const feil: string[] = [];
  for (let i = 0; i < ps.length; i++) {
    const a = ps[i];
    if (a.x < -1e-6 || a.x + a.w > brukbar + 1e-6) feil.push(`Element ${i} utenfor brukbar bredde.`);
    for (let j = i + 1; j < ps.length; j++) {
      const b = ps[j];
      const dx = Math.max(a.x - (b.x + b.w), b.x - (a.x + a.w));
      const dy = Math.max(a.y - (b.y + b.h), b.y - (a.y + a.h));
      if (dx < gap - 1e-4 && dy < gap - 1e-4) {
        feil.push(dx < -1e-6 && dy < -1e-6
          ? `Overlapp mellom ${i} og ${j}.` : `For liten klaring mellom ${i} og ${j}.`);
      }
    }
  }
  return feil;
}

export function pakkFritt(motiver: Motiv[], geo: Geo, tillatRotasjon = true): Ark & {
  strategi: string; feil: string[]; brukbarBredde: number; skjaerebredde: number;
} {
  const reservert = geo.kissInset + geo.regClear + (geo.regmarkD + 2 * geo.regmarkKiss) + geo.regClear;
  const endemargin = geo.kissInset + geo.regClear + geo.regmarkKiss + geo.regmarkD / 2;
  // maskinen skjaerer kanskje smalere enn rullen
  const skjaere = Math.min(geo.skjaerebredde ?? geo.foliebredde, geo.foliebredde);
  const brukbar = skjaere - 2 * reservert;

  const items: Item[] = [];
  motiver.forEach((m, i) => {
    for (let k = 0; k < m.antall; k++) {
      items.push({ w: m.breddeMm + 2 * geo.bleed, h: m.hoydeMm + 2 * geo.bleed,
                   id: i, navn: m.navn });
    }
  });
  for (const it of items) {
    const side = tillatRotasjon ? Math.min(it.w, it.h) : it.w;
    if (side > brukbar) {
      throw new Error(`${it.navn} gir en boks pa ${it.w.toFixed(1)} mm og far ikke ` +
        `plass i brukbar skjaerebredde ${brukbar.toFixed(1)} mm.`);
    }
  }

  let best: { ut: Plassering[]; h: number; navn: string } | null = null;
  /**
   * Tette logogrupper (Eirik 16.11.2026: «husk at elementene kan
   * roteres»): nestes paa selve formen, i alle fire retninger, saa de
   * griper inn i hverandre.
   */
  const nest = motiver.length && motiver.every((m) => m.thruForm?.length)
    ? nestForm(motiver, items, brukbar, geo, tillatRotasjon) : null;
  for (const st of STRATEGIER) {
    for (const rot of tillatRotasjon ? [true, false] : [false]) {
      const r = pakkEn(items.slice().sort(st.key), brukbar, geo.gap, rot);
      if (!r) continue;
      if (!best || r.h < best.h - 1e-9) best = { ...r, navn: st.navn + (rot ? ", med rotasjon" : ", uten rotasjon") };
    }
  }
  if (!best) throw new Error("Fant ingen gyldig pakking.");

  /**
   * Kant i kant (Eirik 16.11.2026, prinsippet fra klebemerkene): to rette
   * sider som ligger mot hverandre trenger ikke mellomrom. De legges kant i
   * kant, og linjen skjaeres én gang. Bare sider som er rette faar 0;
   * de andre beholder halve gapet hver, saa mellomrommet mot en skraa kant
   * aldri blir mindre enn gap/2.
   */
  let kant = false;
  if (motiver.length && motiver.every((m) => m.sider)) {
    const k = pakkKant(motiver, items, brukbar, geo.gap, tillatRotasjon);
    if (k && k.h < best.h + 1e-6) { best = k; kant = true; }
  }

  /**
   * Rammer som foelger formen, med rett bunn (Eirik 16.11.2026). Pakkes paa
   * et hoeydeprofil. Gir det ikke kortere ark enn rektanglene, brukes
   * rektanglene: formede rammer er bare verdt det naar de sparer folie.
   */
  let formet = false;
  if (motiver.some((m) => m.omriss?.length)) {
    const p = pakkProfil(motiver, items, brukbar, geo, tillatRotasjon);
    if (p && p.h < best.h - 1) { best = p; formet = true; }
  }

  // formnestingen brukes bare naar den gir kortere ark enn rammene
  const nestet = !!nest && nest.h < best.h - 1;
  if (nestet) { best = nest!; formet = false; }
  // kant i kant: mellomrommet er bygget inn per side (0 eller gap/2), saa
  // rektangelsjekken med fullt gap ville meldt falsk. Der sjekkes bare overlapp.
  const feil = formet ? sjekkFormet(best.ut, geo.gap) : nestet ? []
    : sjekk(best.ut, brukbar, kant ? 0 : geo.gap);
  // Arket blir bare sa bredt som jobben faktisk trenger. Resten av rullen
  // ligger urort, og forbrukstallet blir aerlig.
  const brukt = Math.max(...best.ut.map((p) => p.x + p.w));
  // rundes opp til hel millimeter, sa arkmalet blir til a lese
  const arkbredde = Math.min(skjaere, Math.ceil(brukt + 2 * reservert));
  const arklengde = best.h + 2 * endemargin;
  const spenn = arklengde - 2 * endemargin;
  const n = Math.max(1, Math.round(spenn / geo.regTarget));
  const avstand = spenn / n;
  const regY: number[] = [];
  for (let i = 0; i <= n; i++) regY.push(endemargin + i * avstand);

  const flytt = (r?: P[]) => r?.map(([x, y]) => [x + reservert, y + endemargin] as P);
  const plasseringer = best.ut.map((p) => ({ ...p, x: p.x + reservert, y: p.y + endemargin,
    ...(p.ramme ? { ramme: flytt(p.ramme), kiss: flytt(p.kiss) } : {}) }));
  const xV = geo.kissInset + geo.regClear + geo.regmarkKiss + geo.regmarkD / 2;
  const bw = geo.regmarkD + 2 * geo.regmarkKiss;
  const topp = regY[0] - geo.regmarkD / 2 - geo.regmarkKiss;
  const hoy = regY[regY.length - 1] + geo.regmarkD / 2 + geo.regmarkKiss - topp;

  return {
    plasseringer, arklengde, breddeMm: arkbredde, regY, xVenstre: xV,
    xHoyre: arkbredde - xV,
    regBokser: [
      [geo.kissInset + geo.regClear, topp, bw, hoy],
      [arkbredde - geo.kissInset - geo.regClear - bw, topp, bw, hoy],
    ],
    strategi: best.navn, feil, brukbarBredde: brukbar, skjaerebredde: skjaere,
  };
}


/** Formede rammer: ingen to naermere enn gap. */
function sjekkFormet(ps: Plassering[], gap: number): string[] {
  const feil: string[] = [];
  for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) {
    const a = ps[i], b = ps[j];
    if (a.x - gap > b.x + b.w || b.x - gap > a.x + a.w || a.y - gap > b.y + b.h || b.y - gap > a.y + a.h) continue;
    const ra = a.ramme ?? rekt(a), rb = b.ramme ?? rekt(b);
    if (forNaer(ra, rb, gap)) feil.push(`For liten klaring mellom ${i} og ${j}.`);
  }
  return feil;
}

const rekt = (p: { x: number; y: number; w: number; h: number }): P[] =>
  [[p.x, p.y], [p.x + p.w, p.y], [p.x + p.w, p.y + p.h], [p.x, p.y + p.h]];

/** kolonnebredde i profilet, mm */
const RES = 2;
/** hvor tett posisjonene proeves, i kolonner */
const STEG = 2;

interface Form { w: number; h: number; ramme: P[]; kiss: P[]; topp: Float64Array; bunn: Float64Array; kol: number }

/**
 * Pakkingen fyller arket ovenfra og ned, og et nytt element maa ligge under
 * alt som allerede ligger i de samme kolonnene. Med rett bunn nederst gir
 * det ingen gevinst: et nytt element legger seg alltid paa en rett kant.
 * Derfor pakkes ogsaa speilvendt (bunnene mot arkets start), slik at
 * toppene lager daler de neste elementene kan falle ned i. Hele oppsettet
 * speiles tilbake etterpaa, saa elementene staar rett vei. Begge retninger
 * proeves, og den korteste vinner.
 */

/**
 * Rammen for ett motiv i boks-koordinater (y nedover, origo oeverst til
 * venstre i boksen w x h), uten og med rotasjon. Rotasjonen er den samme
 * som Design-laget bruker i byggProduksjonsfil.
 */
function former(m: Motiv, geo: Geo, speil: boolean): [Form, Form] {
  const W = m.breddeMm, H = m.hoydeMm, bl = geo.bleed;
  let lok = m.omriss?.length ? rammeLokal(m.omriss, m.bbox, m.skala, bl) : null;
  if (!lok) lok = [[-bl, -bl], [W + bl, -bl], [W + bl, H + bl], [-bl, H + bl]];
  const lag = (rot: boolean, speil: boolean): Form => {
    const w = (rot ? H : W) + 2 * bl, h = (rot ? W : H) + 2 * bl;
    const ramme = lok!.map(([u, v]) => (rot ? [bl + H - v, W + bl - u] : [u + bl, H + bl - v]) as P);
    const kiss = offsetRinger([ramme], geo.boksKiss, true)[0] ?? ramme;
    // konvolutten: rammen utvidet med halve gapet, flyttet saa den starter i 0
    const env = (offsetRinger([ramme], geo.gap / 2, true)[0] ?? ramme)
      .map(([x, y]) => [x + geo.gap / 2, (speil ? h - y : y) + geo.gap / 2] as P);
    const kol = Math.ceil((w + geo.gap) / RES) + 1;
    const pr = profil(env, kol, RES);
    return { w, h, ramme, kiss, topp: pr.topp, bunn: pr.bunn, kol };
  };
  return [lag(false, speil), lag(true, speil)];
}

function pakkProfil(motiver: Motiv[], items: Item[], brukbar: number, geo: Geo, rot: boolean):
  { ut: Plassering[]; h: number; navn: string } | null {
  const N = Math.floor((brukbar + geo.gap) / RES);
  let best: { ut: Plassering[]; h: number; navn: string } | null = null;
  for (const speil of [true, false]) {
  const formAv = motiver.map((m) => former(m, geo, speil));
  for (const st of STRATEGIER) {
    for (const r of rot ? [true, false] : [false]) {
      const sky = new Float64Array(N).fill(0);
      const ut: Plassering[] = [];
      let ok = true;
      for (const it of items.slice().sort(st.key)) {
        let valgt: { y: number; c: number; f: Form; rot: boolean; laveste: number } | null = null;
        for (const rr of r ? [false, true] : [false]) {
          const f = formAv[it.id][rr ? 1 : 0];
          if (f.w > brukbar + 1e-6) continue;
          const maksC = Math.floor((brukbar - f.w) / RES);
          if (maksC < 0) continue;
          const cs: number[] = [];
          for (let c = 0; c <= maksC; c += STEG) cs.push(c);
          if (cs[cs.length - 1] !== maksC) cs.push(maksC);
          for (const c of cs) {
            let y = 0;
            for (let j = 0; j < f.kol && c + j < N; j++) {
              if (f.topp[j] === Infinity) continue;
              const k = sky[c + j] - f.topp[j];
              if (k > y) y = k;
            }
            const laveste = y + f.h;
            if (!valgt || laveste < valgt.laveste - 1e-9 ||
                (Math.abs(laveste - valgt.laveste) < 1e-9 && c < valgt.c)) valgt = { y, c, f, rot: rr, laveste };
          }
        }
        if (!valgt) { ok = false; break; }
        const { y, c, f } = valgt;
        for (let j = 0; j < f.kol && c + j < N; j++) {
          if (f.bunn[j] === -Infinity) continue;
          const b = y + f.bunn[j];
          if (b > sky[c + j]) sky[c + j] = b;
        }
        const x = c * RES;
        const fl = (q: P[]) => q.map(([a, b]) => [a + x, b + y] as P);
        ut.push({ x, y, w: f.w, h: f.h, rotated: valgt.rot, id: it.id, ramme: fl(f.ramme), kiss: fl(f.kiss) });
      }
      if (!ok || !ut.length) continue;
      const h = Math.max(...ut.map((p) => p.y + p.h));
      if (speil) for (const p of ut) {
        // speil tilbake: boksen flyttes, rammen er allerede rett vei i boksen
        const ny = h - (p.y + p.h), dy = ny - p.y;
        p.ramme = p.ramme!.map(([a, b]) => [a, b + dy] as P);
        p.kiss = p.kiss!.map(([a, b]) => [a, b + dy] as P);
        p.y = ny;
      }
      if (!best || h < best.h - 1e-9) best = { ut, h, navn: `formede rammer, ${st.navn}${r ? ", med rotasjon" : ", uten rotasjon"}` };
    }
  }
  }
  return best;
}


/**
 * Kant-i-kant-pakking. Hver boks faar halvt gap paa sidene som ikke er
 * rette og 0 paa de rette, og pakkes uten gap. Sidene foelger rotasjonen
 * slik Design-laget roterer (90 grader: topp til venstre, bunn til hoeyre,
 * hoeyre til topp, venstre til bunn).
 */
function pakkKant(motiver: Motiv[], items: Item[], brukbar: number, gap: number, rot: boolean):
  { ut: Plassering[]; h: number; navn: string } | null {
  const pad = (rett: boolean) => (rett ? 0 : gap / 2);
  const retning = (m: Motiv, r: boolean) => {
    const [v, h, b, t] = m.sider!;
    // [venstre, hoeyre, topp, bunn] paa arket (y nedover)
    const s = r ? [t, b, h, v] : [v, h, t, b];
    return { pl: pad(s[0]), pr: pad(s[1]), pt: pad(s[2]), pb: pad(s[3]) };
  };
  let best: { ut: Plassering[]; h: number; navn: string } | null = null;
  for (const st of STRATEGIER) {
    for (const r of rot ? [true, false] : [false]) {
      const sky = new Skyline(brukbar);
      const ut: Plassering[] = [];
      let ok = true;
      for (const it of items.slice().sort(st.key)) {
        const m = motiver[it.id];
        let valgt: { x: number; y: number; w: number; h: number; rr: boolean; top: number; p: ReturnType<typeof retning> } | null = null;
        for (const rr of r ? [false, true] : [false]) {
          const p = retning(m, rr);
          const w = (rr ? it.h : it.w) + p.pl + p.pr, h = (rr ? it.w : it.h) + p.pt + p.pb;
          const f = sky.finn(w, h, false);
          if (f && (!valgt || f.top < valgt.top - 1e-9)) valgt = { x: f.x, y: f.y, w, h, rr, top: f.top, p };
        }
        if (!valgt) { ok = false; break; }
        sky.legg(valgt.x, valgt.y, valgt.w, valgt.h);
        ut.push({ x: valgt.x + valgt.p.pl, y: valgt.y + valgt.p.pt,
          w: valgt.rr ? it.h : it.w, h: valgt.rr ? it.w : it.h, rotated: valgt.rr, id: it.id });
      }
      if (!ok || !ut.length) continue;
      const h = Math.max(...ut.map((p) => p.y + p.h));
      if (!best || h < best.h - 1e-9) best = { ut, h, navn: `kant i kant, ${st.navn}${r ? ", med rotasjon" : ", uten rotasjon"}` };
    }
  }
  return best;
}


/**
 * Formnesting paa rutenett. Hver form utvidet med halve gapet rastreres
 * konservativt (en rute er opptatt hvis formen beroerer den), saa to former
 * som ikke deler rute, ligger minst et gap fra hverandre. Hver form proeves i
 * fire retninger og legges der toppen blir lavest (saa lengst til venstre).
 */
const NEST_RES = 2.5;
const MM = 72 / 25.4;
function nestForm(motiver: Motiv[], items: Item[], brukbar: number, geo: Geo, rot: boolean):
  { ut: Plassering[]; h: number; navn: string } | null {
  const r = NEST_RES, halv = geo.gap / 2;
  const kol = Math.ceil((brukbar + 2 * halv) / r) + 1;
  const sumH = items.reduce((s, it) => s + Math.max(it.w, it.h) + geo.gap, 0);
  const rader = Math.ceil(sumH / r) + 2;
  const opptatt = new Uint8Array(kol * rader);
  const pre = new Int32Array(rader * (kol + 1));
  const oppdater = (j: number) => {
    let a = 0; const o = j * (kol + 1);
    for (let i = 0; i < kol; i++) { a += opptatt[j * kol + i]; pre[o + i + 1] = a; }
  };
  type Var = { w: number; h: number; rot: boolean; snu: boolean; spenn: [number, number, number][]; rader: number };
  const varianter = (it: Item): Var[] => {
    const m = motiver[it.id], b = m.bbox, k = m.skala / MM, bl = geo.bleed;
    const ut: Var[] = [];
    for (const rr of rot ? [false, true] : [false]) for (const snu of [false, true]) {
      const w = rr ? m.hoydeMm + 2 * bl : m.breddeMm + 2 * bl, h = rr ? m.breddeMm + 2 * bl : m.hoydeMm + 2 * bl;
      const til = ([X, Y]: number[]): [number, number] => {
        let u = rr ? bl + (b[3] - Y) * k : bl + (X - b[0]) * k;
        let v = rr ? h - bl - (X - b[0]) * k : h - bl - (Y - b[1]) * k;
        if (snu) { u = w - u; v = h - v; }
        return [u, v];
      };
      const ringer = m.thruForm!.map((poly) => poly[0].map(til));
      // utvidet med halve gapet, forskjoevet saa ruten starter i -halv
      const utv = offsetRinger(ringer, halv).map((rg) => rg.map(([x, y]) => [x + halv, y + halv] as [number, number]));
      const hoyde = h + 2 * halv;
      const nr = Math.ceil(hoyde / r);
      const spenn: [number, number, number][] = [];
      for (let j = 0; j < nr; j++) {
        const y0 = j * r, y1 = y0 + r;
        let biter: any;
        try {
          biter = pc.intersection(utv.map((rg) => [[...rg, rg[0]]]) as any,
            [[[-1e3, y0], [1e5, y0], [1e5, y1], [-1e3, y1], [-1e3, y0]]] as any);
        } catch { biter = []; }
        for (const poly of biter) {
          const xs = poly[0].map((q: number[]) => q[0]);
          spenn.push([j, Math.max(0, Math.floor(Math.min(...xs) / r)), Math.ceil(Math.max(...xs) / r)]);
        }
      }
      ut.push({ w, h, rot: rr, snu, spenn, rader: nr });
    }
    return ut;
  };
  const kolliderer = (v: Var, c: number, rad: number) => {
    for (const [j, a, e] of v.spenn) {
      const jj = rad + j;
      if (jj >= rader) return true;
      const aa = c + a, ee = Math.min(kol, c + e);
      if (ee <= aa) continue;
      const o = jj * (kol + 1);
      if (pre[o + ee] - pre[o + aa] > 0) return true;
    }
    return false;
  };
  const cache = new Map<Item, Var[]>();
  const varAv = (it: Item) => cache.get(it) ?? cache.set(it, varianter(it)).get(it)!;
  let beste: { ut: Plassering[]; h: number; navn: string } | null = null;
  // flere rekkefoelger og to maater aa velge plass paa; den korteste vinner
  for (const st of STRATEGIER) for (const tyngde of [false, true]) {
  opptatt.fill(0); pre.fill(0);
  const ut: Plassering[] = [];
  let ok = true;
  for (const it of items.slice().sort(st.key)) {
    let valgt: { c: number; rad: number; v: Var; topp: number } | null = null;
    for (const v of varAv(it)) {
      if (v.w > brukbar + 1e-6) continue;
      const maksC = Math.floor((brukbar - v.w) / r);
      for (let c = 0; c <= maksC; c++) {
        for (let rad = 0; rad + v.rader <= rader; rad++) {
          // tyngde: laveste overkant (rad) foerst, ellers laveste underkant
          const maal = (tyngde ? rad * r : rad * r + v.h);
          if (valgt && maal >= valgt.topp - 1e-9) break;
          if (!kolliderer(v, c, rad)) {
            if (!valgt || maal < valgt.topp - 1e-9) valgt = { c, rad, v, topp: maal };
            break;
          }
        }
      }
    }
    if (!valgt) { ok = false; break; }
    const { c, rad, v } = valgt;
    for (const [j, a, e] of v.spenn) {
      const jj = rad + j;
      for (let i = c + a; i < Math.min(kol, c + e); i++) opptatt[jj * kol + i] = 1;
      oppdater(jj);
    }
    ut.push({ x: c * r, y: rad * r, w: v.w, h: v.h, rotated: v.rot, id: it.id, ...(v.snu ? { snu: true } : {}) });
  }
  if (!ok) continue;
  const h = Math.max(...ut.map((p) => p.y + p.h));
  if (!beste || h < beste.h - 1e-9) beste = { ut, h, navn: `formnesting, fire retninger, ${st.navn}${tyngde ? ", tyngde" : ""}` };
  }
  return beste;
}
