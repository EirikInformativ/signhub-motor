/**
 * Rammer som foelger elementets form (Eirik 16.11.2026).
 *
 * Thru-cut-rammen og kiss-cut-boksen var rektangler. De trenger ikke vaere
 * det: rammen kan foelge elementets form, saa elementene kan nestes
 * tettere. Bunnen skal alltid vaere bein, for den er grunnlinjen montoeren
 * retter elementet inn etter.
 *
 * Formen: det konvekse skallet rundt elementets omriss utvidet med bleed
 * og den rette bunnen. Konvekst fordi thru-cut ikke kan ha innvendige
 * hjoerner: der rivner folien, og arket blir slapt.
 *
 * Pakkingen legger rammene paa et hoeydeprofil i stedet for paa rektangler:
 * et element med lav kant kan legges inntil et hoeyt, og et smalt element
 * kan falle ned i en dal mellom to topper.
 */
import * as pcModul from "polygon-clipping";
import * as clipperModul from "clipper-lib";
import type { MultiPoly } from "./pdfbaner.ts";
const pc: any = (pcModul as any).default ?? pcModul;
const ClipperLib: any = (clipperModul as any).default ?? clipperModul;

export type P = [number, number];
const MM = 72 / 25.4;
const S = 1000;

function tilC(r: P[]) { return r.map(([x, y]) => ({ X: Math.round(x * S), Y: Math.round(y * S) })); }
function fraC(r: any[]): P[] { return r.map((q) => [q.X / S, q.Y / S] as P); }

/** Utvider (eller krymper) ringer; rette hjoerner for rammer, runde ellers. */
export function offsetRinger(ringer: P[][], d: number, rett = false): P[][] {
  const co = new ClipperLib.ClipperOffset(4, 0.05 * S);
  co.AddPaths(ringer.map(tilC), rett ? ClipperLib.JoinType.jtMiter : ClipperLib.JoinType.jtRound,
    ClipperLib.EndType.etClosedPolygon);
  const res: any[] = [];
  co.Execute(res, d * S);
  return res.map(fraC).filter((r) => r.length > 2);
}

function forenkle(r: P[], tol: number): P[] {
  const c = ClipperLib.Clipper.CleanPolygon(tilC(r), tol * S);
  return fraC(c);
}

const lukk = (r: P[]) => (r.length && (r[0][0] !== r[r.length - 1][0] || r[0][1] !== r[r.length - 1][1]) ? [...r, r[0]] : r);

/**
 * Rammen i elementets eget rom: mm, y opp, origo i nedre venstre hjoerne av
 * elementets ramme (bbox). Bunnen ligger paa y = -bleed.
 */
export function rammeLokal(omriss: MultiPoly, bbox: [number, number, number, number],
                           skala: number, bleed: number): P[] | null {
  const k = skala / MM;
  const ytre: P[][] = omriss.map((poly) => poly[0].map(([x, y]) => [(x - bbox[0]) * k, (y - bbox[1]) * k] as P))
    .filter((r) => r.length > 2);
  if (!ytre.length) return null;
  // ytterkantene med hullene fylt, saa utvidet med bleed og forenklet
  let fylt: any;
  try { fylt = pc.union(...ytre.map((r) => [[lukk(r)]]) as [any]); } catch { return null; }
  const ut = offsetRinger(fylt.map((p: any) => p[0] as P[]), bleed).map((r) => forenkle(r, 0.3));
  if (!ut.length) return null;
  const xs = ut.flat().map((p) => p[0]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  /**
   * Thru-cut kan ikke vaere konkav (Eirik 16.11.2026): i et innvendig
   * hjoerne rivner folien, og en lang innbuktning gjoer arket slapt.
   * Rammen er derfor det konvekse skallet rundt formen og den rette bunnen.
   */
  const skall = konvekstSkall([...ut.flat(), [x0, -bleed], [x1, -bleed]]);
  return skall.length > 2 ? forenkle(skall, 0.05) : null;
}

/** Konvekst skall (monotone chain), mot klokka. */
export function konvekstSkall(pk: P[]): P[] {
  const p = pk.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const kryss = (o: P, a: P, b: P) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const ned: P[] = [], opp: P[] = [];
  for (const q of p) { while (ned.length >= 2 && kryss(ned[ned.length - 2], ned[ned.length - 1], q) <= 0) ned.pop(); ned.push(q); }
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (opp.length >= 2 && kryss(opp[opp.length - 2], opp[opp.length - 1], q) <= 0) opp.pop(); opp.push(q); }
  return [...ned.slice(0, -1), ...opp.slice(0, -1)];
}

/**
 * Hoeydeprofil for en ring i en boks med y nedover: for hver kolonne
 * (bredde `res`) laveste og hoeyeste y. Kolonner uten noe har topp
 * +Infinity og bunn -Infinity.
 */
export function profil(r: P[], kolonner: number, res: number): { topp: Float64Array; bunn: Float64Array } {
  const topp = new Float64Array(kolonner).fill(Infinity);
  const bunn = new Float64Array(kolonner).fill(-Infinity);
  const n = r.length;
  const tak = (j: number, y: number) => {
    if (j < 0 || j >= kolonner) return;
    if (y < topp[j]) topp[j] = y;
    if (y > bunn[j]) bunn[j] = y;
  };
  for (let i = 0; i < n; i++) {
    const a = r[i], b = r[(i + 1) % n];
    // hjoernene og kanten samplet inne i hver kolonne den krysser
    const xa = Math.min(a[0], b[0]), xb = Math.max(a[0], b[0]);
    tak(Math.floor(a[0] / res), a[1]);
    tak(Math.floor(b[0] / res), b[1]);
    if (xb - xa < 1e-9) continue;
    const j0 = Math.floor(xa / res), j1 = Math.floor(xb / res);
    for (let j = j0; j <= j1; j++) {
      for (const x of [j * res, (j + 1) * res - 1e-9]) {
        if (x < xa || x > xb) continue;
        const t = (x - a[0]) / (b[0] - a[0]);
        tak(j, a[1] + t * (b[1] - a[1]));
      }
    }
  }
  return { topp, bunn };
}

/** Avstand mellom to rammer er minst `gap`: den ene utvidet treffer ikke den andre. */
export function forNaer(a: P[], b: P[], gap: number): boolean {
  try {
    const u = offsetRinger([a], gap - 0.05, true);
    const snitt = pc.intersection(u.map((r) => [lukk(r)]) as any, [[lukk(b)]] as any);
    return snitt.some((poly: any) => {
      const r = poly[0]; let s = 0;
      for (let i = 0; i < r.length - 1; i++) s += r[i][0] * r[i + 1][1] - r[i + 1][0] * r[i][1];
      return Math.abs(s / 2) > 0.01;
    });
  } catch { return false; }
}
