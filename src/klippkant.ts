/**
 * Dekor som gaar inn under bilens egne deler (Eirik 16.11.2026, Kia PV5
 * 310079).
 *
 * Designeren tegner dekoren stoerre enn den synes, og lar bilen dekke
 * resten: den sorte A-en gaar opp under vindusruta og speilet, og den
 * lange stripen inn under hjulbuene. I CCVision-skissen er dette ikke en
 * klippebane (W), men bildeler som tegnes oppaa dekoren. Det skjulte havner
 * paa graaplast, glass eller ingenting, og er sloeseri.
 *
 * Eirik gjorde dette for hand: en linje eller offset path paa kanten, og
 * elementet kuttet etter den. Montoerene skjaerer til dekoren for hand
 * etter montering, saa folien maa gaa et stykke inn under kanten.
 *
 * Regelen: det synlige er dekoren minus bildelene som er tegnet etter den.
 * Dekoren kuttes langs det synlige utvidet med KLIPP_LUFT_MM (50 mm ekte
 * maal), med hullene fylt, saa en doerhaandtak eller et speil inne i
 * dekoren aldri blir et hull. Alt som synes, skjaeres som foer. Det som
 * fjernes, er bare det montoeren uansett ville skaaret bort, og det meldes.
 *
 * Gaar dekoren mindre enn KLIPP_MIN_MM inn under en bildel, meldes det:
 * montoeren trenger noe aa skjaere til etter (stripen bak paa Kia gaar bare
 * noen faa millimeter inn under hjulbuen).
 */
import * as pcModul from "polygon-clipping";
import * as clipperModul from "clipper-lib";
import type { Bane } from "./uttrekk.ts";
import { konvekstSkall } from "./ramme.ts";
const pc: any = (pcModul as any).default ?? pcModul;
const ClipperLib: any = (clipperModul as any).default ?? clipperModul;

type Pt = [number, number];
type Ring = Pt[];

export const KLIPP_LUFT_MM = 50;
export const KLIPP_MIN_MM = 20;
const GJENNOMSYN = 0.05;
/** et gjennomsyn er tynnere enn 2 x 0,25 x KLIPP_MIN_MM = 10 mm */
const GJENNOMSYN_TYKK = 0.25;
/** knotter i det synlige under 2 x 0,5 x KLIPP_MIN_MM = 20 mm faar bare 10 mm rundt seg */
const KNOTT_ANDEL = 0.5;
/** en knott er mindre enn 4 x KLIPP_MIN_MM² = 1600 mm² (tappen ved speilfoten paa Kia er rundt 700) */
const KNOTT_MAKS = 4;

/** Segmentene som ringer, kurvene delt i rette biter. */
export function ringerAv(segs: any[]): Ring[] {
  const ut: Ring[] = [];
  let r: Ring = [];
  const slutt = () => { if (r.length > 2) ut.push(r); r = []; };
  for (const s of segs) {
    if (s.t === "m") { slutt(); r = [s.p]; }
    else if (s.t === "l") r.push(s.p);
    else if (s.t === "c") {
      const p0 = r[r.length - 1] ?? s.a;
      for (let i = 1; i <= 12; i++) {
        const t = i / 12, u = 1 - t;
        r.push([
          u * u * u * p0[0] + 3 * u * u * t * s.a[0] + 3 * u * t * t * s.b[0] + t * t * t * s.c[0],
          u * u * u * p0[1] + 3 * u * u * t * s.a[1] + 3 * u * t * t * s.b[1] + t * t * t * s.c[1],
        ]);
      }
    } else if (s.t === "h") slutt();
  }
  slutt();
  return ut;
}

/** Flaten ringene dekker, etter partallsregelen. */
function flate(ringer: Ring[]): any {
  const deler = ringer.map((r) => [[[...r, r[0]]]]);
  if (!deler.length) return [];
  try { return pc.xor(...(deler as [any])); } catch { return null; }
}

function utvid(mp: any, d: number): any {
  const S = 1e3;
  const co = new ClipperLib.ClipperOffset(2, 0.25);
  for (const poly of mp) for (const r of poly)
    co.AddPath(r.map(([x, y]: Pt) => ({ X: Math.round(x * S), Y: Math.round(y * S) })),
      ClipperLib.JoinType.jtRound, ClipperLib.EndType.etClosedPolygon);
  const res: any[] = [];
  co.Execute(res, d * S);
  const ringer: Ring[] = res.map((p: any[]) => p.map((q) => [q.X / S, q.Y / S] as Pt)).filter((r) => r.length > 2);
  return flate(ringer) ?? [];
}

/** Bare ytterringene: et hull i det tillatte skal aldri bli hull i dekoren. */
const utenHull = (mp: any) => mp.map((poly: any) => [poly[0]]);

export function areal(mp: any): number {
  let a = 0;
  for (const poly of mp ?? []) poly.forEach((r: Ring, i: number) => {
    let s = 0;
    for (let k = 0; k < r.length - 1; k++) s += r[k][0] * r[k + 1][1] - r[k + 1][0] * r[k][1];
    a += (i === 0 ? 1 : -1) * Math.abs(s / 2);
  });
  return a;
}

const overlapper = (a: Bane["boks"], b: Bane["boks"]) =>
  a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

export interface KlippResultat {
  baner: Bane[];
  /** areal tatt bort og areal foer, i tegnede enheter i andre */
  fjernet: number;
  foer: number;
  /** baner (etter kuttet) som gaar for kort inn under en bildel og ikke lot seg forlenge */
  kortForbi: Bane[];
  /** baner der smaa gjennomsyn under bilen er sett bort fra */
  gjennomsyn: number;
  /** baner som er forlenget inn under en bildel */
  forlenget: number;
  /** baner der smaa synlige knotter ved kanten er kuttet bort */
  knotter: number;
}

/**
 * `dekor` er dekorbanene som skal kuttes. `alle` er skissens baner i
 * tegnerekkefoelge. `erDekor` sier hvilke av dem som er dekor (de dekker
 * aldri annen dekor her: lagene i en logo bygges i kjorJobb). `luft` og
 * `min` er i tegnede enheter.
 */
export function kuttVedBildeler(dekor: Bane[], alle: Bane[], erDekor: (b: Bane) => boolean,
                                luft: number, min: number): KlippResultat {
  const indeks = new Map(alle.map((b, i) => [b, i]));
  let fjernet = 0, foer = 0, gjennomsyn = 0, lagtTil = 0, knotter = 0;
  const korte = new Set<Bane>();
  const ut = dekor.map((b) => {
    if (!b.fyll || b.strek) return b;
    const i = indeks.get(b);
    if (i === undefined) return b;
    const dekk = alle.slice(i + 1).filter((o) => o.fyll && !erDekor(o) && overlapper(o.boks, b.boks));
    if (!dekk.length) return b;
    const egen = flate(ringerAv(b.segs as any[]));
    if (!egen || !egen.length) return b;
    const a0 = areal(egen);
    let skjult: any, dekkSamlet: any;
    try {
      const dekkFlater = dekk.map((o) => flate(ringerAv(o.segs as any[]))).filter((f) => f && f.length);
      if (!dekkFlater.length) return b;
      dekkSamlet = pc.union(...(dekkFlater as [any]));
      skjult = pc.intersection(egen, dekkSamlet);
    } catch { return b; }
    if (areal(skjult) < a0 * 1e-3) return b;                // ingenting av betydning er dekket
    let synlig: any;
    try { synlig = pc.difference(egen, skjult); } catch { return b; }
    if (!synlig.length) return b;                            // helt skjult: la den staa, meld ikke
    /**
     * Smaa synlige oeyer langt inne under bilen er gjennomsyn, ikke dekor:
     * paa Kia synes den sorte A-en i en glippe mellom hjulbue og dekk, sort
     * paa sort. Den biten skal ikke styre kuttet. Oeyer under GJENNOMSYN av
     * den stoerste synlige delen som ogsaa er tynnere enn 10 mm, teller ikke
     * som synlige.
     */
    const maks = Math.max(...synlig.map((p: any) => areal([p])));
    // bare smaa OG tynne oeyer: en kort, men ekte synlig bit (en stump
    // stripe mellom to bildeler) er bred nok til aa overleve krympingen
    const tynn = (p: any) => { try { return areal(utvid([p], -min * GJENNOMSYN_TYKK)) <= 0; } catch { return false; } };
    const store = synlig.filter((p: any) => areal([p]) >= maks * GJENNOMSYN || !tynn(p));
    if (store.length < synlig.length) gjennomsyn++;
    synlig = store;
    foer += a0;
    // naar dekoren minst `min` inn under bildelen? Ligger noe av det skjulte
    // lenger inn enn `min`, rekker den langt nok et sted
    let kort = false;
    try { kort = areal(pc.difference(skjult, utvid(synlig, min))) < a0 * 1e-4; } catch { /* bare melding */ }
    if (kort) korte.add(b);
    /**
     * Det tillatte: det synlige utvidet med `luft`, og saa det konvekse
     * skallet rundt det, saa kuttlinjen blir rett (Eirik 16.11.2026: «forstaar
     * ikke hvorfor ikke disse bare gjoeres bein i toppen»). Utvidet med en
     * rund kant fikk toppen av A-en en dupp der beina moetes.
     *
     * Smaa knotter i det synlige tas ikke med: en flekk sort ved speilfoten
     * paa Kia ga foerst en halvsirkel paa 50 mm radius, og saa en tapp oppaa
     * A-en. Det synlige aapnes (krympes og vokser tilbake med KNOTT_ANDEL x
     * min), og det som forsvinner er en knott naar biten er mindre enn
     * KNOTT_MAKS x min². Stoerre biter er ekte dekor og blir staaende.
     */
    const r = min * KNOTT_ANDEL;
    let grunnlag = synlig;
    try {
      const aapnet = utvid(utvid(synlig, -r), r);
      if (aapnet.length) {
        const rest = pc.difference(synlig, aapnet);
        const store = rest.filter((p: any) => areal([p]) >= KNOTT_MAKS * min * min);
        // avrundede hjoerner fra aapningen er ikke knotter; bare biter som betyr noe meldes
        if (rest.some((p: any) => { const a = areal([p]); return a < KNOTT_MAKS * min * min && a > 0.25 * min * min; })) knotter++;
        grunnlag = store.length ? pc.union(aapnet, store) : aapnet;
      }
    } catch { grunnlag = synlig; }
    let tillatt: any;
    try {
      const pkt = utvid(grunnlag, luft).flatMap((poly: any) => poly[0].slice(0, -1) as Pt[]);
      const skall = konvekstSkall(pkt);
      tillatt = skall.length > 2 ? [[[...skall, skall[0]]]] : utenHull(utvid(grunnlag, luft));
    } catch { tillatt = utenHull(utvid(synlig, luft)); }
    let ny: any;
    try { ny = pc.intersection(egen, tillatt); } catch { return b; }
    /**
     * Gaar dekoren for kort inn under bildelen, forlenges den (Eirik
     * 16.11.2026: «forlenge den selv»). Det skjulte vokser `luft` videre
     * inn under bildelen, men bare i dekorens egen retning: en liggende
     * form vokser sidelengs innenfor sin egen hoeyde, en staaende opp og ned
     * innenfor sin egen bredde. Slik blir enden av en stripe lengre, ikke
     * tykkere. Det lagt til ligger under bildelen og synes ikke.
     */
    if (kort) {
      try {
        const bb = { x0: Math.min(...egen.flat(2).map((q: Pt) => q[0])), x1: Math.max(...egen.flat(2).map((q: Pt) => q[0])),
                     y0: Math.min(...egen.flat(2).map((q: Pt) => q[1])), y1: Math.max(...egen.flat(2).map((q: Pt) => q[1])) };
        const L = luft;
        // dekorens retning: en liggende form vokser sidelengs, en staaende opp og ned
        const kryss = bb.x1 - bb.x0 >= bb.y1 - bb.y0
          ? [[[[bb.x0 - L, bb.y0], [bb.x1 + L, bb.y0], [bb.x1 + L, bb.y1], [bb.x0 - L, bb.y1], [bb.x0 - L, bb.y0]]]]
          : [[[[bb.x0, bb.y0 - L], [bb.x1, bb.y0 - L], [bb.x1, bb.y1 + L], [bb.x0, bb.y1 + L], [bb.x0, bb.y0 - L]]]];
        const tillegg = pc.intersection(utvid(skjult, L), dekkSamlet, kryss, utenHull(utvid(synlig, L)));
        if (areal(tillegg) > 0) { ny = pc.union(ny, tillegg); lagtTil++; korte.delete(b); }
      } catch { /* forlengelsen er en bonus; uten den meldes det */ }
    }
    const a1 = areal(ny);
    if (!ny.length || Math.abs(a0 - a1) < a0 * 1e-3) return b;
    const nyBane = { ...b } as Bane;
    fjernet += Math.max(0, a0 - a1);
    const segs: any[] = [];
    for (const poly of ny) for (const r of poly) {
      segs.push({ t: "m", p: r[0] });
      for (let k = 1; k < r.length - 1; k++) segs.push({ t: "l", p: r[k] });
      segs.push({ t: "h" });
    }
    const pts = segs.filter((s) => s.p).map((s) => s.p as Pt);
    const boks = {
      x0: Math.min(...pts.map((p) => p[0])), y0: Math.min(...pts.map((p) => p[1])),
      x1: Math.max(...pts.map((p) => p[0])), y1: Math.max(...pts.map((p) => p[1])),
    };
    nyBane.segs = segs; nyBane.boks = boks;
    if (korte.has(b)) { korte.delete(b); korte.add(nyBane); }
    return nyBane;
  });
  return { baner: ut, fjernet, foer, kortForbi: [...korte], gjennomsyn, forlenget: lagtTil, knotter };
}
