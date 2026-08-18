/**
 * Tynneste folistripe i et motiv, malt pa geometrien.
 *
 * Hver flate krympes innover til den forsvinner. Halve krympingen er
 * tykkelsen pa flatens tykkeste punkt. Den tynneste flaten bestemmer om
 * motivet lar seg luke.
 *
 * Dette erstattet en bildebasert maling med fast opplosning. Den bommet
 * grovt pa filer med sma artboards: Truck Agent ble malt til 2,20 mm,
 * men er i virkeligheten 1,10 mm.
 *
 * clipper-lib er ren JavaScript. Ingen WASM, ingen arbeidertrad, ingen
 * filer som ma serveres ved siden av. Det gjor at den bare virker i
 * nettleseren.
 */
import * as clipperModul from "clipper-lib";
// clipper-lib er CommonJS. Ta hoyde for begge mater den kan komme inn pa.
const ClipperLib: any = (clipperModul as any).default ?? clipperModul;
import type { MultiPoly, Poly } from "./pdfbaner.ts";

const SKALA = 1e4;          // Clipper regner i heltall
const MITER = 2;
const BUE_TOL = 0.25 * SKALA / 1e4;

type Punkt = { X: number; Y: number };

function tilClipper(poly: Poly): Punkt[][] {
  return poly.map((ring) =>
    ring.map(([x, y]) => ({ X: Math.round(x * SKALA), Y: Math.round(y * SKALA) }))
  );
}

function tomtEtterKrymping(baner: Punkt[][], delta: number): boolean {
  const co = new (ClipperLib as any).ClipperOffset(MITER, BUE_TOL);
  co.AddPaths(baner, (ClipperLib as any).JoinType.jtMiter,
              (ClipperLib as any).EndType.etClosedPolygon);
  const ut: Punkt[][] = [];
  co.Execute(ut, -delta * SKALA);
  if (!ut.length) return true;
  // hull krymper utover og kan spise opp flaten, sa vi ma se pa netto areal
  let areal = 0;
  for (const p of ut) {
    let a = 0;
    for (let i = 0; i < p.length; i++) {
      const q = p[i], s = p[(i + 1) % p.length];
      a += q.X * s.Y - s.X * q.Y;
    }
    areal += a / 2;
  }
  return Math.abs(areal) < 1;
}

export interface Tykkelse {
  tynnesteMm: number;
  perFlateMm: number[];
}

/** Ligger igjen sa gammel kode ikke brekker. Trenger ingen oppstart lenger. */
export async function klargjor(): Promise<void> { /* ingenting */ }

/**
 * flate: geometrien i kildens punkter.
 * skala: hvor mange ganger motivet forstorres i produksjon.
 */
export async function tynnesteDetalj(
  flate: MultiPoly, skala: number, minArealMm2 = 1.0
): Promise<Tykkelse> {
  const mmPerPt = (skala * 25.4) / 72;
  const ut: number[] = [];

  for (const poly of flate) {
    // netto areal, hull trukket fra
    let a = 0;
    poly.forEach((ring, k) => {
      let s = 0;
      for (let i = 0; i < ring.length; i++) {
        const p = ring[i], q = ring[(i + 1) % ring.length];
        s += p[0] * q[1] - q[0] * p[1];
      }
      a += (k === 0 ? 1 : -1) * Math.abs(s / 2);
    });
    if (a * mmPerPt * mmPerPt < minArealMm2) continue;

    // omkrets, brukt til a gjette en startverdi
    let om = 0;
    for (const ring of poly) {
      for (let i = 0; i < ring.length; i++) {
        const p = ring[i], q = ring[(i + 1) % ring.length];
        om += Math.hypot(q[0] - p[0], q[1] - p[1]);
      }
    }
    const baner = tilClipper(poly);
    let hi = Math.max(om ? (a / om) * 2 : 1e-9, 1e-9);
    let sikring = 0;
    while (!tomtEtterKrymping(baner, hi) && sikring++ < 40) hi *= 2;

    let lo = 0;
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      if (tomtEtterKrymping(baner, mid)) hi = mid;
      else lo = mid;
    }
    ut.push(2 * lo * mmPerPt);
  }

  return { tynnesteMm: ut.length ? Math.min(...ut) : 0, perFlateMm: ut };
}
