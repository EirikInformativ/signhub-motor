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
/** en stripe er minst saa mange ganger lengre enn bred (som i kjorJobb) */
const STRIPE_FORHOLD = 8;

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
export function flate(ringer: Ring[]): any {
  const deler = ringer.map((r) => [[[...r, r[0]]]]);
  if (!deler.length) return [];
  try { return pc.xor(...(deler as [any])); } catch { return null; }
}

export function utvid(mp: any, d: number, rett = false): any {
  const S = 1e3;
  const co = new ClipperLib.ClipperOffset(rett ? 4 : 2, 0.25);
  for (const poly of mp) for (const r of poly)
    co.AddPath(r.map(([x, y]: Pt) => ({ X: Math.round(x * S), Y: Math.round(y * S) })),
      rett ? ClipperLib.JoinType.jtMiter : ClipperLib.JoinType.jtRound, ClipperLib.EndType.etClosedPolygon);
  const res: any[] = [];
  co.Execute(res, d * S);
  const ringer: Ring[] = res.map((p: any[]) => p.map((q) => [q.X / S, q.Y / S] as Pt)).filter((r) => r.length > 2);
  return flate(ringer) ?? [];
}

/** Unionen av flatene, med ClipperLib. */
export function clipUnion(fs: any[]): any {
  const S = 1e3;
  const c = new ClipperLib.Clipper();
  for (const mp of fs) for (const poly of mp) for (const r of poly)
    c.AddPath(r.map(([x, y]: Pt) => ({ X: Math.round(x * S), Y: Math.round(y * S) })), ClipperLib.PolyType.ptSubject, true);
  const res: any[] = [];
  c.Execute(ClipperLib.ClipType.ctUnion, res, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);
  const ringer: Ring[] = res.map((p: any[]) => p.map((q) => [q.X / S, q.Y / S] as Pt)).filter((r) => r.length > 2);
  return flate(ringer) ?? [];
}

/** a minus alle i bs, med ClipperLib (taaler hakkete geometri bedre enn polygon-clipping). */
export function clipDiff(a: any, bs: any[]): any {
  const S = 1e3;
  const c = new ClipperLib.Clipper();
  const til = (mp: any) => { const ut: any[] = []; for (const poly of mp) for (const r of poly) ut.push(r.map(([x, y]: Pt) => ({ X: Math.round(x * S), Y: Math.round(y * S) }))); return ut; };
  c.AddPaths(til(a), ClipperLib.PolyType.ptSubject, true);
  for (const b of bs) c.AddPaths(til(b), ClipperLib.PolyType.ptClip, true);
  const res: any[] = [];
  c.Execute(ClipperLib.ClipType.ctDifference, res, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);
  const ringer: Ring[] = res.map((p: any[]) => p.map((q) => [q.X / S, q.Y / S] as Pt)).filter((r) => r.length > 2);
  return flate(ringer) ?? [];
}

/** Snittet av a og b, med ClipperLib. */
export function clipInter(a: any, b: any): any {
  const S = 1e3;
  const c = new ClipperLib.Clipper();
  const til = (mp: any) => { const ut: any[] = []; for (const poly of mp) for (const r of poly) ut.push(r.map(([x, y]: Pt) => ({ X: Math.round(x * S), Y: Math.round(y * S) }))); return ut; };
  c.AddPaths(til(a), ClipperLib.PolyType.ptSubject, true);
  c.AddPaths(til(b), ClipperLib.PolyType.ptClip, true);
  const res: any[] = [];
  c.Execute(ClipperLib.ClipType.ctIntersection, res, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);
  const ringer: Ring[] = res.map((p: any[]) => p.map((q) => [q.X / S, q.Y / S] as Pt)).filter((r) => r.length > 2);
  return flate(ringer) ?? [];
}

const rektangel = (x0: number, y0: number, x1: number, y1: number) => [[[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]]];
export const sirkel = (cx: number, cy: number, r: number, n = 72) => {
  const ring: Pt[] = [];
  for (let i = 0; i < n; i++) ring.push([cx + r * Math.cos((2 * Math.PI * i) / n), cy + r * Math.sin((2 * Math.PI * i) / n)]);
  return [[[...ring, ring[0]]]];
};

/**
 * Lakk som synes innenfor et omraade: fyll i lakkfargen, innenfor sitt eget
 * klipp, minus alt som er tegnet etter det. Feltet selv dekker bare der det
 * synes (innenfor sitt klipp): der designeren har klippet feltet bort,
 * synes lakken, ogsaa om feltbanen ligger der (Saethre: graatt ved siden av
 * trekanten bak og under hjoernet oeverst bak).
 */
function synligLakk(alle: Bane[], rg: Bane["boks"], felt: number, feltSynlig: any): any {
  if (!feltLakk) return [];
  const R = rektangel(rg.x0, rg.y0, rg.x1, rg.y1);
  const lakk: any[] = [];
  alle.forEach((o, j) => {
    if (!o.fyll || o.bilde || !feltLakk!(o) || !overlapper(o.boks, rg)) return;
    let f = flate(ringerAv(o.segs as any[]));
    if (!f?.length) return;
    f = clipInter(f, R);
    const kl = klippFlate(o);
    if (kl?.length) f = clipInter(f, kl);
    if (!f.length) return;
    const dekk: any[] = [];
    for (let q = j + 1; q < alle.length; q++) {
      const d = alle[q];
      if (q === felt || (!d.fyll && !d.bilde) || feltLakk!(d) || !overlapper(d.boks, o.boks) || !overlapper(d.boks, rg)) continue;
      let g = flate(ringerAv(d.segs as any[]));
      if (!g?.length) continue;
      const k2 = klippFlate(d);
      if (k2?.length) g = clipInter(g, k2);
      if (g.length) dekk.push(g);
    }
    if (felt > j && feltSynlig?.length) dekk.push(feltSynlig);
    const s2 = dekk.length ? clipDiff(f, dekk) : f;
    if (s2.length) lakk.push(s2);
  });
  return lakk.length ? clipUnion(lakk) : [];
}

/**
 * Dekkene i skissen: nesten sorte, runde flater paa 500 til 950 mm. Brukes
 * til aa gi felt utfallende inn til dekket under hele hjulbuen (Eirik
 * 18.11.2026: «dekket paa bilen pleier aa vaere en god pekepinn paa hvor
 * utfallende boer ligge»).
 */
export function finnDekk(alle: Bane[], perMm: number): { cx: number; cy: number; r: number; j: number }[] {
  const ut: { cx: number; cy: number; r: number; j: number }[] = [];
  for (let j = 0; j < alle.length; j++) {
    const o = alle[j];
    if (!o.fyll || o.bilde) continue;
    const c = o.farge as any;
    const moerk = Array.isArray(c) && (c.length === 4 ? c[0] < 0.1 && c[1] < 0.1 && c[2] < 0.1 && c[3] >= 0.85 : c.length === 3 ? Math.max(...c) < 0.15 : c.length === 1 ? c[0] < 0.15 : false);
    if (!moerk) continue;
    const w = o.boks.x1 - o.boks.x0, h = o.boks.y1 - o.boks.y0;
    if (Math.abs(w / h - 1) > 0.1 || w / perMm < 500 || w / perMm > 950) continue;
    let a = 0;
    try { a = areal(flate(ringerAv(o.segs as any[]))); } catch { continue; }
    const fyll = a / ((Math.PI / 4) * w * h);
    if (fyll < 0.95 || fyll > 1.05) continue;
    ut.push({ cx: (o.boks.x0 + o.boks.x1) / 2, cy: (o.boks.y0 + o.boks.y1) / 2, r: (w + h) / 4, j });
  }
  return ut;
}

/** Det som synes av bane j: innenfor sitt klipp, minus alt tegnet etter den (unntatt `unntak`). */
function synligAv(alle: Bane[], j: number, unntak: number): any {
  const o = alle[j];
  let f = flate(ringerAv(o.segs as any[]));
  if (!f?.length) return [];
  const kl = klippFlate(o);
  if (kl?.length) f = clipInter(f, kl);
  const dekk: any[] = [];
  for (let q = j + 1; q < alle.length; q++) {
    const d = alle[q];
    if (q === unntak || (!d.fyll && !d.bilde) || !overlapper(d.boks, o.boks)) continue;
    let g = flate(ringerAv(d.segs as any[]));
    if (!g?.length) continue;
    const k2 = klippFlate(d);
    if (k2?.length) g = clipInter(g, k2);
    if (g.length) dekk.push(g);
  }
  return dekk.length ? clipDiff(f, dekk) : f;
}

/** feltets lakk som synes rundt det, til kutteformen i bilmotor */
export const feltLakkSynlig = new WeakMap<Bane, any>();
/** tegnede enheter per mm, satt av lesBilskisse sammen med lakkfargen */
let feltPerMm = 1;
/** utfallende under hjulbuen gaar inntil dette forbi det synlige, men aldri inn paa dekket */
const FELT_BUE_TIL_DEKK_MM = 250;
/** synlige prikker i et felt under dette (mm²) er designerens rusk og styrer ikke kuttet */
const FELT_PRIKK_MM2 = 2500;
/** en synlig oey deles i en smal hals under 2 x dette (mm) */
const FELT_HALS_MM = 40;
/** halsen ligger over hjulbuen: innenfor dette fra dekket */
const FELT_BUE_HALS_MM = 400;

/** Bare ytterringene: et hull i det tillatte skal aldri bli hull i dekoren. */
const utenHull = (mp: any) => mp.map((poly: any) => [poly[0]]);

/**
 * Klippebanen designeren har lagt paa en dekorbane (W n), som synlig del.
 * Gir det synlige som flate, eller null naar banen ikke er klippet.
 */
export function klippFlate(b: Bane): any | null {
  if (!b.klipp?.length) return null;
  let k: any = null;
  for (const kl of b.klipp) {
    const f = flate(ringerAv(kl.segs as any[]));
    if (!f) return null;
    k = k ? pc.intersection(k, f) : f;
  }
  return k;
}

/** Rammen rundt det som synes av banen (klippet), eller hele banen. */
export function synligBoks(b: Bane): { x0: number; y0: number; x1: number; y1: number } {
  const k = klippFlate(b);
  if (!k || !k.length) return b.boks;
  const pk = k.flat(2) as Pt[];
  return { x0: Math.max(b.boks.x0, Math.min(...pk.map((p) => p[0]))), y0: Math.max(b.boks.y0, Math.min(...pk.map((p) => p[1]))),
    x1: Math.min(b.boks.x1, Math.max(...pk.map((p) => p[0]))), y1: Math.min(b.boks.y1, Math.max(...pk.map((p) => p[1]))) };
}

/**
 * Dekor som designeren har klippet (Vito 304160: den store Ø-en klippet
 * langs bilens bakkant) kuttes `luft` forbi klippet, som dekor under
 * bilens deler (Eirik 16.11.2026: 50 mm). Bare naar banen gaar mer enn
 * `luft` forbi klippet; ellers staar den hel.
 */
/** banen kuttVedKlipp laget en kuttet kopi av, saa kopien finnes igjen i tegnerekkefoelgen */
export const opphavAv = new WeakMap<Bane, Bane>();
/**
 * Store felt (Saethre): kuttes langs det synlige med denne luften og rette
 * hjoerner, ikke det konvekse skallet. Hjulbuen foelger buen (Eirik
 * 18.11.2026, hjelpeskissen: «noen kutteformer maa tegnes og noen kan vi
 * bruke allerede eksisterende clippingmask»).
 */
export const feltLuft = new WeakMap<Bane, number>();
/**
 * Fyll i bilens lakkfarge tegnet oppaa et felt er en stripe i designet, ikke
 * en bildel (Eirik 18.11.2026, Saethre: «den grå skillestripen ... har samme
 * fargekode som lakken, skal den dele det oransje feltet»). Settes av
 * lesBilskisse for hver skisse.
 */
let feltLakk: ((o: Bane) => boolean) | null = null;
const KLIPP_DEKK = true;
/** en synlig oey er et eget feltstykke naar den er minst saa stor som andel av den stoerste */
const OEY_STOR = 0.03;
export function settFeltLakk(f: ((o: Bane) => boolean) | null, perMm = 1) { feltLakk = f; feltPerMm = perMm; }
export function erFeltLakk(o: Bane): boolean { return !!feltLakk?.(o); }

export function kuttVedKlipp(b: Bane, luft: number, rett = false): Bane {
  const k = klippFlate(b);
  if (!k || !k.length) return b;
  const egen = flate(ringerAv(b.segs as any[]));
  if (!egen || !egen.length) return b;
  let ny: any;
  try { ny = pc.intersection(egen, utvid(utenHull(k), luft, rett)); } catch { return b; }
  const a0 = areal(egen), a1 = areal(ny);
  if (!ny.length || a1 > a0 * 0.999) return b;
  const segs: any[] = [];
  for (const poly of ny) for (const r of poly) {
    segs.push({ t: "m", p: r[0] });
    for (let i = 1; i < r.length - 1; i++) segs.push({ t: "l", p: r[i] });
    segs.push({ t: "h" });
  }
  const pts = segs.filter((x) => x.p).map((x) => x.p as Pt);
  const ut = { ...b, segs, boks: { x0: Math.min(...pts.map((p) => p[0])), y0: Math.min(...pts.map((p) => p[1])),
    x1: Math.max(...pts.map((p) => p[0])), y1: Math.max(...pts.map((p) => p[1])) } } as Bane;
  opphavAv.set(ut, opphavAv.get(b) ?? b);
  return ut;
}

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
  /** baner som ligger helt skjult under bilens egne deler: de synes ikke paa bilen og er ikke dekor */
  helSkjult: Bane[];
  /** striper med ender under bildelene som er rettet ut til rektangel */
  rettet: number;
}

/** Retningen til en stripe: én konveks flate, minst STRIPE_FORHOLD ganger saa lang som bred. */
export function stripeRetning(mp: any): { ux: number; uy: number } | null {
  if (mp.length !== 1 || mp[0].length !== 1) return null;
  const r = mp[0][0] as Pt[];
  const skall = konvekstSkall(r.slice(0, -1));
  if (areal(mp) < 0.98 * Math.abs(areal([[[...skall, skall[0]]]]))) return null;
  let best = 0, ux = 1, uy = 0;
  for (let i = 0; i < r.length - 1; i++) {
    const dx = r[i + 1][0] - r[i][0], dy = r[i + 1][1] - r[i][1], l = Math.hypot(dx, dy);
    if (l > best) { best = l; ux = dx / l; uy = dy / l; }
  }
  if (ux < 0) { ux = -ux; uy = -uy; }
  const pk = r.map((q) => [q[0] * ux + q[1] * uy, -q[0] * uy + q[1] * ux]);
  const L = Math.max(...pk.map((q) => q[0])) - Math.min(...pk.map((q) => q[0]));
  const B = Math.max(...pk.map((q) => q[1])) - Math.min(...pk.map((q) => q[1]));
  return L >= STRIPE_FORHOLD * B ? { ux, uy } : null;
}

/**
 * Stripens to lange kanter som linjer v = a + b*u i stripens egne
 * koordinater (u langs, v paa tvers). En skraa stripe (smalner av) faar da
 * endene forlenget i den retningen kantene gaar (Eirik 16.11.2026: «det er
 * jo bare aa fortsette linjene i den retningen de er paa vei»), ikke et
 * rektangel paa full bredde.
 */
export function stripeKanter(mp: any, st: { ux: number; uy: number }):
  { lo: (u: number, ende: number) => number; hi: (u: number, ende: number) => number } | null {
  const pk = (mp.flat(2) as Pt[]).map((q) => [q[0] * st.ux + q[1] * st.uy, -q[0] * st.uy + q[1] * st.ux] as Pt);
  if (pk.length < 3) return null;
  const sk = konvekstSkall(pk);
  const u0 = Math.min(...sk.map((q) => q[0])), u1 = Math.max(...sk.map((q) => q[0])), L = u1 - u0;
  if (!(L > 0)) return null;
  // skallets oevre og nedre kant som funksjon av u (interpolert)
  const kant = (oevre: boolean) => (u: number) => {
    let best: number | null = null;
    for (let i = 0; i < sk.length; i++) {
      const p = sk[i], q = sk[(i + 1) % sk.length];
      const a = Math.min(p[0], q[0]), b = Math.max(p[0], q[0]);
      if (u < a - 1e-9 || u > b + 1e-9) continue;
      const v = b - a < 1e-12 ? (oevre ? Math.max(p[1], q[1]) : Math.min(p[1], q[1]))
        : p[1] + ((q[1] - p[1]) * (u - p[0])) / (q[0] - p[0]);
      if (best === null || (oevre ? v > best : v < best)) best = v;
    }
    return best ?? 0;
  };
  const ov = kant(true), ne = kant(false);
  /**
   * Linja gjennom kanten ved enden og kanten et stykke inn (en firedel av
   * lengden), forlenget forbi enden. ende er u-verdien enden ligger ved.
   */
  const linje = (f: (u: number) => number) => (u: number, ende: number) => {
    const inn = ende <= (u0 + u1) / 2 ? 1 : -1;
    const ea = Math.min(u1, Math.max(u0, ende + inn * 0.02 * L)), eb = ea + inn * 0.25 * L;
    const va = f(ea), vb = f(eb);
    return va + ((vb - va) * (u - ea)) / (eb - ea);
  };
  return { lo: linje(ne), hi: linje(ov) };
}

/**
 * Feltet i én farge: det som synes av alle banene, delt i oeyer (og i smale
 * halser), hver oey med utfallende kant `fl` inn under bildelene og utenfor
 * bilen, inn til dekket under hjulbuen, aldri ut over lakk som synes.
 */
function feltSamlet0(bs: Bane[], alle: Bane[], indeks: Map<Bane, number>, erDekor: (b: Bane) => boolean): { form: any; lakk: any } | null {
  const fl = feltLuft.get(bs[0]) ?? feltLuft.get(opphavAv.get(bs[0])!)!;
  const mm = feltPerMm;
  const synlige: any[] = [];
  let rg = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  for (const b of bs) {
    const i = indeks.get(b) ?? indeks.get(opphavAv.get(b)!);
    if (i === undefined) continue;
    const orig = alle[i];
    const origF = flate(ringerAv(orig.segs as any[]));
    if (!origF?.length) continue;
    const k = klippFlate(orig);
    let f = k?.length ? clipInter(origF, k) : origF;
    const dekk: any[] = [];
    for (let q = i + 1; q < alle.length; q++) {
      const o = alle[q];
      if ((!o.fyll && !o.bilde) || erDekor(o) || !overlapper(o.boks, orig.boks)) continue;
      let g = flate(ringerAv(o.segs as any[]));
      if (!g?.length) continue;
      const k2 = klippFlate(o);
      if (k2?.length) g = clipInter(g, k2);
      if (g.length) dekk.push(g);
    }
    if (dekk.length) f = clipDiff(f, dekk);
    if (f.length) synlige.push(f);
    const bb = b.boks;
    rg = { x0: Math.min(rg.x0, bb.x0), y0: Math.min(rg.y0, bb.y0), x1: Math.max(rg.x1, bb.x1), y1: Math.max(rg.y1, bb.y1) };
  }
  if (!synlige.length) return null;
  rg = { x0: rg.x0 - 4 * fl, y0: rg.y0 - 4 * fl, x1: rg.x1 + 4 * fl, y1: rg.y1 + 4 * fl };
  const synlig = clipUnion(synlige);
  // designerens rusk (Eirik 18.11.2026: «vi boer vite bedre enn aa legge utfallende for den»)
  let syn = (synlig as any[]).filter((p) => areal([p]) >= FELT_PRIKK_MM2 * mm * mm);
  if (!syn.length) syn = synlig;
  const storst0 = Math.max(...syn.map((p) => areal([p])));
  /*
   * En smal hals over hjulbuen deler oeyen (Saethre: hjoernet bak hjulet
   * henger sammen med det skraa feltet over buen; Eirik vil ha dem hver for
   * seg, som hjoernet foran). Bare halser ved et dekk: smale striper ellers
   * i feltet er design.
   */
  const dekk0 = finnDekk(alle, mm);
  const bueSone = dekk0.length ? clipUnion(dekk0.map((d) => clipInter(sirkel(d.cx, d.cy, d.r + FELT_BUE_HALS_MM * mm), rektangel(d.cx - 3 * d.r, d.cy, d.cx + 3 * d.r, d.cy + 3 * d.r)))) : [];
  const oeyer: any[] = [];
  for (const p of syn) {
    if (areal([p]) < OEY_STOR * storst0 || !bueSone.length) { oeyer.push([p]); continue; }
    let hals: any[] = [];
    try { hals = clipInter(clipDiff([p], [utvid(utvid([p], -FELT_HALS_MM * mm), FELT_HALS_MM * mm)]), bueSone); } catch { hals = []; }
    const rest = hals.length ? clipDiff([p], [hals]) : [];
    const d2 = rest.filter((q: any) => areal([q]) >= OEY_STOR * storst0);
    if (d2.length < 2) { oeyer.push([p]); continue; }
    for (const q of rest) oeyer.push([q]);
    for (const q of hals) oeyer.push([q]);
  }
  const storst = Math.max(...oeyer.map((o) => areal(o)));
  const store = oeyer.filter((o) => areal(o) >= OEY_STOR * storst).sort((a, b) => areal(b) - areal(a));
  const smaa = oeyer.filter((o) => !store.includes(o));
  if (process.env.FELT_OEY) console.log("OEY", oeyer.map((o) => Math.round(areal(o) / mm / mm)).join(" "));
  const grupper = store.map((o) => [o]);
  for (const sm of smaa) {
    let best = 0, bd = Infinity;
    const c = sm[0][0][0];
    store.forEach((o, k) => { const d = Math.min(...o[0][0].map((q: Pt) => Math.hypot(q[0] - c[0], q[1] - c[1]))); if (d < bd) { bd = d; best = k; } });
    grupper[best].push(sm);
  }
  let lakk: any = [];
  try { lakk = synligLakk(alle, rg, -1, null); } catch { lakk = []; }
  const dekkene = finnDekk(alle, mm).filter((d) => d.cx + d.r > rg.x0 && d.cx - d.r < rg.x1 && d.cy + d.r > rg.y0 && d.cy - d.r < rg.y1);
  const deler: any[] = [];
  for (const g of grupper) {
    const gU = g.length > 1 ? clipUnion(g) : g[0];
    let tg = utvid(gU, fl, true);
    /*
     * Under hjulbuen gaar folien inn til dekket rundt hele buen (Eirik
     * 18.11.2026: «hvorfor har du bare fulgt 75 mm rundt hjulbuen halvveis?»).
     */
    if (dekkene.length) {
      const naa = utvid(gU, FELT_BUE_TIL_DEKK_MM * mm, false);
      for (const d of dekkene) {
        const sone = clipDiff(clipInter(sirkel(d.cx, d.cy, d.r + FELT_BUE_TIL_DEKK_MM * mm), rektangel(d.cx - 3 * d.r, d.cy, d.cx + 3 * d.r, d.cy + 3 * d.r)), [sirkel(d.cx, d.cy, d.r)]);
        const til = clipInter(naa, sone);
        if (til.length) tg = clipUnion([tg, til]);
      }
      tg = clipDiff(tg, dekkene.map((d) => sirkel(d.cx, d.cy, d.r)));
    }
    if (lakk.length) tg = clipDiff(tg, [lakk]);
    // utfallende gaar aldri inn over et annet stykke som synes
    const andre = grupper.filter((x) => x !== g).flat();
    if (andre.length) tg = clipDiff(tg, [utvid(clipUnion(andre), fl / 30, true)]);
    for (const d of deler) tg = clipDiff(tg, [utvid(d, fl / 30, true)]);
    // det som er igjen av oeyen selv (ikke biter av utfallende kanten)
    tg = tg.filter((p: any) => { try { return clipInter([p], gU).length > 0; } catch { return true; } });
    if (tg.length) deler.push(tg);
  }
  const form = deler.flatMap((d) => d);
  if (!form.length) return null;
  return { form, lakk };
}

/**
 * `dekor` er dekorbanene som skal kuttes. `alle` er skissens baner i
 * tegnerekkefoelge. `erDekor` sier hvilke av dem som er dekor (de dekker
 * aldri annen dekor her: lagene i en logo bygges i kjorJobb). `luft` og
 * `min` er i tegnede enheter.
 */
/** skallet rundt alle oeyene er saa mye stoerre enn oeyenes egne: da faar hver oey sitt */
const OEY_SKALL = 1.5;

export function kuttVedBildeler(dekor: Bane[], alle: Bane[], erDekor: (b: Bane) => boolean,
                                luft: number, min: number): KlippResultat {
  const indeks = new Map(alle.map((b, i) => [b, i]));
  let fjernet = 0, foer = 0, gjennomsyn = 0, lagtTil = 0, knotter = 0, rettet = 0;
  const korte = new Set<Bane>();
  const skjulte: Bane[] = [];
  /*
   * Feltene i samme farge behandles samlet (Saethre: hjoernet bak er en egen
   * bane, og to baner i samme farge vokste sammen under terskelen). Det som
   * synes av alle banene i fargen er feltet; hver synlige oey faar sin egen
   * utfallende kant, og oeyene holdes fra hverandre.
   */
  const feltSamlet = new Map<Bane, any>();
  const feltBort = new Set<Bane>();
  {
    const perHex = new Map<string, Bane[]>();
    for (const b of dekor) {
      if (!b.fyll || b.strek) continue;
      if ((feltLuft.get(b) ?? feltLuft.get(opphavAv.get(b)!)) === undefined) continue;
      const h = JSON.stringify(b.farge);
      if (!perHex.has(h)) perHex.set(h, []);
      perHex.get(h)!.push(b);
    }
    for (const bs of perHex.values()) {
      try {
        const r = feltSamlet0(bs, alle, indeks, erDekor);
        if (!r) continue;
        feltSamlet.set(bs[0], r);
        for (const b of bs.slice(1)) feltBort.add(b);
      } catch (e) { if (process.env.FELT_OEY) console.log("feltSamlet feilet", e); }
    }
  }
  const ut = dekor.map((b) => {
    if (feltBort.has(b)) return b;
    if (feltSamlet.has(b)) {
      const { form, lakk } = feltSamlet.get(b);
      const segs: any[] = [];
      for (const poly of form) for (const r of poly) {
        segs.push({ t: "m", p: r[0] });
        for (let k = 1; k < r.length - 1; k++) segs.push({ t: "l", p: r[k] });
        segs.push({ t: "h" });
      }
      const pts = segs.filter((q) => q.p).map((q) => q.p as Pt);
      const nyB = { ...b, segs, boks: { x0: Math.min(...pts.map((q) => q[0])), y0: Math.min(...pts.map((q) => q[1])),
        x1: Math.max(...pts.map((q) => q[0])), y1: Math.max(...pts.map((q) => q[1])) } } as Bane;
      feltLakkSynlig.set(b, lakk);
      return nyB;
    }
    if (!b.fyll || b.strek) return b;
    const i = indeks.get(b) ?? indeks.get(opphavAv.get(b)!);
    if (i === undefined) return b;
    // et innsatt bilde tegnet oppaa dekoren dekker den ogsaa: bildet printes
    // og legges paa bilen, folien under synes ikke (Saethre 305007: oransje
    // felt under fotoet)
    const dekk = alle.slice(i + 1).filter((o) => (o.fyll || o.bilde) && !erDekor(o) && overlapper(o.boks, b.boks));
    if (!dekk.length) return b;
    const egen = flate(ringerAv(b.segs as any[]));
    if (!egen || !egen.length) return b;
    const a0 = areal(egen);
    let skjult: any, dekkSamlet: any;
    try {
      const dekkFlater = dekk.map((o) => {
        const f = flate(ringerAv(o.segs as any[]));
        if (!f) return f;
        // en bildel dekker bare det som synes av den, innenfor sitt eget klipp
        // (Saethre: en graa flate tegnet etter hjoernet bak, klippet bort der)
        if (!o.bilde && !(o.klipp?.length && KLIPP_DEKK)) return f;
        const k = klippFlate(o);
        try { return k ? pc.intersection(f, k) : f; } catch { return f; }
      }).filter((f) => f && f.length);
      if (!dekkFlater.length) return b;
      try {
        dekkSamlet = pc.union(...(dekkFlater as [any]));
        skjult = pc.intersection(egen, dekkSamlet);
      } catch {
        // mange og hakkete bildeler (Saethre side 2): ClipperLib i stedet
        dekkSamlet = clipUnion(dekkFlater);
        skjult = clipDiff(egen, [clipDiff(egen, [dekkSamlet])]);
      }
    } catch { return b; }
    if (areal(skjult) < a0 * 1e-3) return b;                // ingenting av betydning er dekket
    let synlig: any;
    try { synlig = pc.difference(egen, skjult); } catch { try { synlig = clipDiff(egen, [skjult]); } catch { return b; } }
    // helt skjult under bildeler (en hvit flate under doerhaandtaket paa
    // Oesterboe): synes ikke paa bilen, er ikke dekor
    if (!synlig.length || areal(synlig) < a0 * 1e-3) { skjulte.push(b); return b; }
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
    /** et felt kan gaa inn under bildelene saa langt designeren har tegnet det, ogsaa forbi sitt eget klipp */
    let grunn: any = egen;
    const fl = feltLuft.get(b) ?? feltLuft.get(opphavAv.get(b)!);
    if (fl !== undefined) {
      /*
       * Feltet kuttes langs det synlige selv (ikke det aapnede, som runder
       * hjoernene), og smale glipper under bildeler som stikker ut (listen
       * langs terskelen) bygges over med lukking, saa kanten blir én rett
       * strek like utenfor bilen, ikke en tynn stripe for seg.
       */
      /*
       * Folien gaar `fl` inn under bildelene (hjulbuen, lyktene, listen
       * langs terskelen) og utenfor bilen, men aldri ut over lakk som synes:
       * kanten designeren har tegnet mot lakken staar som den er (Eirik
       * 18.11.2026: trekanten der alle tre sidene synes skal ikke forstoerres),
       * og stripene i lakkfargen deler feltet.
       */
      try {
        /*
         * Hver synlige oey faar sin egen utfallende kant, og oeyene holdes
         * fra hverandre: to felt som moetes under en bildel (under hjulet)
         * skal ikke vokse sammen til ett stykke (Saethre: hjoernet bak og det
         * skraa feltet). Smaa, tynne oeyer (gjennomsyn langs terskelen)
         * hoerer til naermeste store oey.
         */
        const mm = feltPerMm;
        /*
         * Smaa synlige prikker (designerens rusk ved kanten, Eirik 18.11.2026:
         * «vi boer vite bedre enn aa legge utfallende for den») styrer ikke
         * kuttet.
         */
        const orig = opphavAv.get(b) ?? b;
        const k = klippFlate(orig), origF = flate(ringerAv(orig.segs as any[]));
        // feltet synes der det ligger innenfor sitt klipp og ikke er dekket
        let feltSyn: any = [];
        try { feltSyn = k?.length && origF?.length ? clipDiff(clipInter(origF, k), [dekkSamlet]) : synlig; } catch { feltSyn = synlig; }
        if (!feltSyn.length) feltSyn = synlig;
        let syn = (feltSyn as any[]).filter((p) => areal([p]) >= FELT_PRIKK_MM2 * mm * mm);
        if (!syn.length) syn = feltSyn as any[];
        /*
         * En oey med en smal hals deles i halsen (Saethre: hjoernet bak
         * hjulet henger sammen med det skraa feltet i en smal stripe over
         * hjulbuen; Eirik vil ha dem hver for seg).
         */
        const storst0 = Math.max(...syn.map((p) => areal([p])));
        const oeyer: any[] = [];
        for (const p of syn) {
          if (areal([p]) < OEY_STOR * storst0) { oeyer.push([p]); continue; }
          let deler2: any[] = [];
          try {
            const aap = utvid(utvid([p], -FELT_HALS_MM * mm), FELT_HALS_MM * mm);
            deler2 = aap.filter((q: any) => areal([q]) >= OEY_STOR * storst0);
          } catch { deler2 = []; }
          if (deler2.length < 2) { oeyer.push([p]); continue; }
          for (const q of deler2) oeyer.push([q]);
          for (const q of clipDiff([p], deler2.map((x: any) => [x]))) if (areal([q]) > 0) oeyer.push([q]);
        }
        const storst = Math.max(...oeyer.map((o) => areal(o)));
        const store = oeyer.filter((o) => areal(o) >= OEY_STOR * storst);
        const smaa = oeyer.filter((o) => !store.includes(o));
        if (process.env.FELT_OEY) console.log("OEY", oeyer.map((o) => Math.round(areal(o) / mm / mm)).join(" "));
        const grupper = store.map((o) => [o]);
        for (const sm of smaa) {
          let best = 0, bd = Infinity;
          store.forEach((o, k) => { const c = sm[0][0][0]; const d = Math.min(...o[0][0].map((q: Pt) => Math.hypot(q[0] - c[0], q[1] - c[1]))); if (d < bd) { bd = d; best = k; } });
          grupper[best].push(sm);
        }
        const rg = { x0: b.boks.x0 - 4 * fl, y0: b.boks.y0 - 4 * fl, x1: b.boks.x1 + 4 * fl, y1: b.boks.y1 + 4 * fl };
        let lakkSyn: any = [];
        try { lakkSyn = synligLakk(alle, rg, i, feltSyn); } catch { lakkSyn = []; }
        const dekkene = finnDekk(alle, mm).filter((d) => d.cx + d.r > rg.x0 && d.cx - d.r < rg.x1 && d.cy + d.r > rg.y0 && d.cy - d.r < rg.y1);
        const deler: any[] = [];
        for (const g of grupper) {
          const gU = g.length > 1 ? clipUnion(g) : g[0];
          let tg = utvid(gU, fl, true);
          /*
           * Under hjulbuen gaar folien inn til dekket, rundt hele buen (Eirik
           * 18.11.2026: «hvorfor har du bare fulgt 75 mm rundt hjulbuen
           * halvveis?»): den oevre halvdelen av en ring rundt dekket.
           */
          if (dekkene.length) {
            const naa = utvid(gU, FELT_BUE_TIL_DEKK_MM * mm, false);
            for (const d of dekkene) {
              const sone = clipDiff(clipInter(sirkel(d.cx, d.cy, d.r + FELT_BUE_TIL_DEKK_MM * mm), rektangel(d.cx - 2 * d.r - 1e4, d.cy, d.cx + 2 * d.r + 1e4, d.cy + 2 * d.r + 1e4)), [sirkel(d.cx, d.cy, d.r)]);
              const til = clipInter(naa, sone);
              if (process.env.FELT_OEY) console.log("DEKK", Math.round(d.cx*2.0833), Math.round(1658-d.cy*2.0833), Math.round(areal(sone)/mm/mm), Math.round(areal(til)/mm/mm), Math.round(areal(gU)/mm/mm));
              if (til.length) tg = clipUnion([tg, til]);
            }
            // inn til dekkets ytterkant (sirkelen), ogsaa der skissen viser dekket under buen
            tg = clipDiff(tg, dekkene.map((d) => sirkel(d.cx, d.cy, d.r)));
          }
          for (const d of deler) tg = clipDiff(tg, [utvid(d, fl / 30, true)]);
          deler.push(tg);
        }
        let t = deler.flatMap((d) => d);
        // folien gaar aldri ut over lakk som synes, og stripene i lakkfargen deler feltet
        if (lakkSyn.length) t = clipDiff(t, [lakkSyn]);
        tillatt = t;
        if (process.env.FELT_T) { const fs = require("fs"); fs.appendFileSync(process.env.FELT_T, JSON.stringify({ i, hoved: true, baner: t.flatMap((p: any) => p) }) + "\n"); fs.appendFileSync(process.env.FELT_T, JSON.stringify({ hoved: false, baner: (lakkSyn as any[]).flatMap((p: any) => p) }) + "\n"); }
        // feltet er det som synes pluss utfallende, ikke formen designeren tegnet under bilen
        grunn = null;
        feltLakkSynlig.set(b, lakkSyn);
      } catch { tillatt = utenHull(utvid(synlig, fl, true)); }
    } else try {
      /**
       * Skallet tas per synlige oey, ikke rundt alt (Saethre ID.Buzz
       * 17.11.2026: oransje felt skilt av skraa striper i lakken, tegnet oppaa
       * ett stort oransje felt. Ett skall rundt alle feltene fylte stripene og
       * vinduene igjen, og det ble 50 % mer folie enn i produksjonen).
       */
      const oeyer = utvid(grunnlag, luft);
      const hele = konvekstSkall(oeyer.flatMap((poly: any) => poly[0].slice(0, -1) as Pt[]));
      const skall = oeyer.map((poly: any) => konvekstSkall(poly[0].slice(0, -1) as Pt[])).filter((sk: Pt[]) => sk.length > 2);
      const arSk = (sk: Pt[]) => Math.abs(areal([[[...sk, sk[0]]]] as any));
      // bare naar oeyene ligger langt fra hverandre (felt skilt av lakk); én logo (Oe-en) beholder ett skall
      const hver = skall.length > 1 && skall.length === oeyer.length &&
        arSk(hele) > OEY_SKALL * skall.reduce((t: number, sk: Pt[]) => t + arSk(sk), 0);
      tillatt = hver ? pc.union(...(skall.map((sk: Pt[]) => [[...sk, sk[0]]]) as [any]))
        : hele.length > 2 ? [[[...hele, hele[0]]]] : utenHull(oeyer);
    } catch { tillatt = utenHull(utvid(synlig, luft)); }
    let ny: any;
    try { ny = grunn ? pc.intersection(grunn, tillatt) : tillatt; } catch { try { ny = clipInter(grunn, tillatt); } catch { return b; } }
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
    /**
     * En stripe som gaar godt forbi det som synes, faar rette ender
     * (Eirik 16.11.2026: «kan du ikke gjoere de til perfekte rektangler
     * da?»). Er stripen én hel, rett flate (STRIPE_FORHOLD ganger saa lang
     * som bred), rettes hver ende som ligger under bildelene ut til et
     * rektangel langs stripen. Det legger bare til folie utenfor kuttlinjen,
     * altsaa under bildelen, og enden kan forlenges paa arket senere.
     */
    let skjultEnde: Bane["skjultEnde"];
    try {
      const st = stripeRetning(egen);
      if (st) {
        const proj = (mp: any) => {
          const pk = mp.flat(2) as Pt[];
          const u = pk.map((q) => q[0] * st.ux + q[1] * st.uy), v = pk.map((q) => -q[0] * st.uy + q[1] * st.ux);
          return { u0: Math.min(...u), u1: Math.max(...u), v0: Math.min(...v), v1: Math.max(...v) };
        };
        const n = proj(ny), sy = proj(synlig);
        const lav = n.u0 < sy.u0 - min / 2, hoy = n.u1 > sy.u1 + min / 2;
        if (lav || hoy) {
          const ua = lav ? n.u0 : sy.u0, ub = hoy ? n.u1 : sy.u1;
          const pt = (u: number, v: number): Pt => [u * st.ux - v * st.uy, u * st.uy + v * st.ux];
          // kantene maales paa det som synes, og fortsetter i sin retning
          const kt = stripeKanter(synlig, st);
          const bit = (a: number, b: number, ende: number) => {
            const lo = (u: number) => kt ? kt.lo(u, ende) : n.v0, hi = (u: number) => kt ? kt.hi(u, ende) : n.v1;
            return [[pt(a, lo(a)), pt(b, lo(b)), pt(b, hi(b)), pt(a, hi(a)), pt(a, lo(a))]];
          };
          // det som synes staar urort (motoren fjerner aldri noe); bare den
          // skjulte enden byttes ut med kantene forlenget
          const V = 10 * (n.v1 - n.v0 + 1);
          const skive = [[pt(lav ? sy.u0 : n.u0 - 1, n.v0 - V), pt(hoy ? sy.u1 : n.u1 + 1, n.v0 - V),
            pt(hoy ? sy.u1 : n.u1 + 1, n.v1 + V), pt(lav ? sy.u0 : n.u0 - 1, n.v1 + V), pt(lav ? sy.u0 : n.u0 - 1, n.v0 - V)]];
          const deler = [pc.intersection(ny, skive)];
          if (lav) deler.push(bit(n.u0, sy.u0, sy.u0));
          if (hoy) deler.push(bit(sy.u1, n.u1, sy.u1));
          const rekt = pc.union(...(deler as [any]));
          ny = rekt;
          skjultEnde = { ux: st.ux, uy: st.uy, lav, hoy };
          rettet++;
        }
      }
    } catch { /* uten retting staar kuttet som det er */ }
    const a1 = areal(ny);
    if (!ny.length || (Math.abs(a0 - a1) < a0 * 1e-3 && !skjultEnde)) return b;
    const nyBane = { ...b, ...(skjultEnde ? { skjultEnde } : {}) } as Bane;
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
  // feltene beholder merket sitt gjennom kuttet
  ut.forEach((n, i) => { const fl = feltLuft.get(dekor[i]) ?? feltLuft.get(opphavAv.get(dekor[i])!); if (n !== dekor[i] && fl !== undefined) feltLuft.set(n, fl); const ls = feltLakkSynlig.get(dekor[i]); if (n !== dekor[i] && ls) feltLakkSynlig.set(n, ls); });
  ut.forEach((n, i) => { if (n !== dekor[i] && !opphavAv.has(n)) opphavAv.set(n, opphavAv.get(dekor[i]) ?? dekor[i]); });
  return { baner: ut.filter((b) => !skjulte.includes(b) && !feltBort.has(b)), fjernet, foer, kortForbi: [...korte], gjennomsyn,
    forlenget: lagtTil, knotter, rettet, helSkjult: skjulte };
}


/**
 * Ender av en stripe som slutter ved en kant paa bilen (Eirik 16.11.2026,
 * Kia PV5: stripen bak gaar fra hjoernet til hjoernet av bakdoerene).
 * Montoeren legger folien rundt kanten eller skjaerer til der, saa enden kan
 * forlenges paa arket. En ende teller naar en av bilens egne linjer krysser
 * stripens midtlinje innenfor `tol` (tegnede enheter) fra enden.
 */
export function enderVedKant(b: Bane, alle: Bane[], erDekor: (x: Bane) => boolean, tol: number):
  Bane["skjultEnde"] | undefined {
  if (!b.fyll || b.strek) return undefined;
  const egen = flate(ringerAv(b.segs as any[]));
  const st = egen ? stripeRetning(egen) : null;
  if (!st) return undefined;
  const pk = (egen.flat(2) as Pt[]);
  const u = pk.map((q) => q[0] * st.ux + q[1] * st.uy), v = pk.map((q) => -q[0] * st.uy + q[1] * st.ux);
  const u0 = Math.min(...u), u1 = Math.max(...u), vm = (Math.min(...v) + Math.max(...v)) / 2;
  // bilens linjer som krysser midtlinjen: punktene der, langs stripen
  const kryss: number[] = [];
  const boks = { x0: b.boks.x0 - tol, y0: b.boks.y0 - tol, x1: b.boks.x1 + tol, y1: b.boks.y1 + tol };
  for (const o of alle) {
    if (o === b || erDekor(o) || o.gradient || !overlapper(o.boks, boks)) continue;
    for (const r of ringerAv(o.segs as any[])) {
      const lukket = [...r, r[0]];
      for (let i = 0; i < lukket.length - 1; i++) {
        const [a, c] = [lukket[i], lukket[i + 1]];
        const va = -a[0] * st.uy + a[1] * st.ux, vc = -c[0] * st.uy + c[1] * st.ux;
        if ((va - vm) * (vc - vm) > 0 || va === vc) continue;
        const t = (vm - va) / (vc - va);
        kryss.push((a[0] + t * (c[0] - a[0])) * st.ux + (a[1] + t * (c[1] - a[1])) * st.uy);
      }
    }
  }
  const lav = kryss.some((k) => Math.abs(k - u0) < tol), hoy = kryss.some((k) => Math.abs(k - u1) < tol);
  return lav || hoy ? { ux: st.ux, uy: st.uy, lav, hoy } : undefined;
}


/**
 * Bilens naturlige skjoeter langs en stripe (Eirik 16.11.2026, Vito:
 * stripen skjoetes i doerskjoeten, «viktig da med god overlapp slik at vi
 * kan bruke bilens naturlige skjoet»). En skjoet er en av bilens linjer som
 * krysser hele stripen paa tvers: den krysser baade nedre kvartil, midten og
 * oevre kvartil av stripens bredde paa samme sted (innenfor tol). Linjer
 * naer endene (under kant) teller ikke. Gir stedene som andel av lengden,
 * maalt fra enden med lavest x (liggende stripe) eller lavest y (staaende).
 */
export function skjoterLangs(b: Bane, alle: Bane[], erDekor: (x: Bane) => boolean, tol: number, kant: number, felt = false): number[] {
  if (!b.fyll) return [];
  const egen = flate(ringerAv(b.segs as any[]));
  if (!egen) return [];
  // stripen kan ha knekk i endene (Vito: smaa haker opp ved hjulbuene); da
  // gjelder rammens lange akse
  const bw = b.boks.x1 - b.boks.x0, bh = b.boks.y1 - b.boks.y0;
  // et felt (Saethre: 4,2 m oransje over begge doerene) deles langs sin lange akse
  const st = felt ? (bw >= bh ? { ux: 1, uy: 0 } : { ux: 0, uy: 1 })
    : stripeRetning(egen) ?? (Math.max(bw, bh) >= 8 * Math.min(bw, bh) ? (bw >= bh ? { ux: 1, uy: 0 } : { ux: 0, uy: 1 }) : null);
  if (!st) return [];
  const pk = (egen.flat(2) as Pt[]);
  const u = pk.map((q) => q[0] * st.ux + q[1] * st.uy), v = pk.map((q) => -q[0] * st.uy + q[1] * st.ux);
  const u0 = Math.min(...u), u1 = Math.max(...u);
  // bredden maales paa midten av stripen, ikke paa hakene i endene
  const midt = pk.filter((q, i) => u[i] > u0 + 0.2 * (u1 - u0) && u[i] < u1 - 0.2 * (u1 - u0));
  const vv = (midt.length ? midt : pk).map((q) => -q[0] * st.uy + q[1] * st.ux);
  const v0 = Math.min(...vv), v1 = Math.max(...vv);
  const nivaa = [0.25, 0.5, 0.75].map((t) => v0 + t * (v1 - v0));
  const kryss: number[][] = nivaa.map(() => []);
  for (const o of alle) {
    if (o === b || erDekor(o) || o.gradient || !overlapper(o.boks, b.boks)) continue;
    for (const r of ringerAv(o.segs as any[])) {
      const lukket = [...r, r[0]];
      for (let i = 0; i < lukket.length - 1; i++) {
        const [a, c] = [lukket[i], lukket[i + 1]];
        const va = -a[0] * st.uy + a[1] * st.ux, vc = -c[0] * st.uy + c[1] * st.ux;
        nivaa.forEach((vm, k) => {
          if ((va - vm) * (vc - vm) > 0 || va === vc) return;
          const t = (vm - va) / (vc - va);
          kryss[k].push((a[0] + t * (c[0] - a[0])) * st.ux + (a[1] + t * (c[1] - a[1])) * st.uy);
        });
      }
    }
  }
  const ut: number[] = [];
  for (const k of kryss[1]) {
    if (k < u0 + kant || k > u1 - kant) continue;
    if (!kryss[0].some((x) => Math.abs(x - k) < tol) || !kryss[2].some((x) => Math.abs(x - k) < tol)) continue;
    if (ut.some((x) => Math.abs(x - k) < tol)) continue;
    ut.push(k);
  }
  // andel fra enden med lavest x (eller y), uansett hvilken vei retningen peker
  const snu = Math.abs(st.ux) >= Math.abs(st.uy) ? st.ux < 0 : st.uy < 0;
  return ut.map((k) => { const f = (k - u0) / (u1 - u0); return snu ? 1 - f : f; }).sort((a, b) => a - b);
}
