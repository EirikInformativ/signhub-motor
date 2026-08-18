/**
 * Forhandsvisning av motivet, i de foliefargene som er valgt.
 *
 * Den tegner det som faktisk kommer til a bli skaret, ikke hvordan filen ser
 * ut i Illustrator. Er teksten ikke gjort om til outlines, eller ligger det
 * et usynlig element ute i kanten, ser du det her, for du bruker folie.
 *
 * Bakgrunnen blir gra hvis noen av foliene er sa lyse at motivet ellers ville
 * forsvunnet.
 */
import { hentGeometriPerFarge } from "./pdfbaner.ts";
import type { MultiPoly } from "./pdfbaner.ts";
import * as pcModul from "polygon-clipping";
const pc: any = (pcModul as any).default ?? pcModul;

export type LerretFabrikk = (b: number, h: number) => any;

const nettleserLerret: LerretFabrikk = (b, h) => {
  const c = (globalThis as any).document.createElement("canvas");
  c.width = Math.round(b);
  c.height = Math.round(h);
  return c;
};

export interface ForhandsvisValg {
  /** bredde i piksler, standard 480 */
  bredde?: number;
  /** luft rundt motivet i piksler, standard 10 */
  luft?: number;
  /** overstyrer bakgrunnen. Utelates den, velges hvit eller gra. */
  bakgrunn?: string;
}

export interface Forhandsvisning {
  /** data-URL, kan settes rett i src pa et bilde */
  bilde: string;
  bredde: number;
  hoyde: number;
  /** true hvis bakgrunnen ble gra fordi folien er lys */
  graaBunn: boolean;
}

const lys = (hex: string) => {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const n = parseInt(full.slice(0, 6), 16);
  if (!isFinite(n)) return 0;
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

/**
 * farger: en per farge i filen, i samme rekkefolge som analyserFil() ga dem.
 *   null   fargen er slatt av og smelter inn i den storste som star igjen
 *   utelatt  motivet vises i filens egne farger
 */
export async function forhandsvis(
  pdf: Uint8Array,
  farger?: (string | null)[],
  valg: ForhandsvisValg = {},
  lag: LerretFabrikk = nettleserLerret
): Promise<Forhandsvisning> {
  const bredde = Math.max(40, Math.round(valg.bredde ?? 480));
  const luft = Math.max(0, Math.round(valg.luft ?? 10));

  const per = await hentGeometriPerFarge(pdf, 1.0);
  if (!per.lag.length) throw new Error("Fant ingen baner i filen.");

  const gyldig = (v: unknown): v is string =>
    typeof v === "string" && /^#?[0-9a-fA-F]{3,8}$/.test(v.trim());

  const deler: { hex: string; flate: MultiPoly }[] = [];
  if (farger?.length) {
    let venter: MultiPoly = [];
    per.lag.forEach((l, i) => {
      const v = farger[i];
      // bare et uttrykkelig null betyr av. Mangler fargen enna, vises
      // motivet i filens egen farge i stedet for a bli sort.
      if (v === null) {
        venter = venter.length
          ? (pc.union(venter as any, l.flate as any) as MultiPoly) : l.flate;
        return;
      }
      deler.push({ hex: gyldig(v) ? (v.startsWith("#") ? v : "#" + v) : l.hex,
                   flate: l.flate });
    });
    if (!deler.length) throw new Error("Alle farger er slatt av.");
    if (venter.length) {
      deler[0].flate = pc.union(deler[0].flate as any, venter as any) as MultiPoly;
    }
  } else {
    for (const l of per.lag) deler.push({ hex: l.hex, flate: l.flate });
  }

  const [x0, y0, x1, y1] = per.bbox;
  const bw = Math.max(x1 - x0, 1e-9);
  const bh = Math.max(y1 - y0, 1e-9);
  const innhold = bredde - 2 * luft;
  const s = innhold / bw;
  const hoyde = Math.round(bh * s) + 2 * luft;

  const graaBunn = deler.some((d) => lys(d.hex) > 0.8);
  const c = lag(bredde, hoyde);
  const g = c.getContext("2d");
  g.fillStyle = valg.bakgrunn ?? (graaBunn ? "#BCBCBC" : "#FFFFFF");
  g.fillRect(0, 0, bredde, hoyde);

  const dx = luft - s * x0;
  const dy = hoyde - luft + s * y0;   // y snus
  // nederste lag forst, sa det oyverste dekker slik det skal
  for (const del of [...deler].reverse()) {
    g.fillStyle = del.hex;
    g.beginPath();
    for (const poly of del.flate) {
      for (const ring of poly) {
        if (ring.length < 3) continue;
        g.moveTo(ring[0][0] * s + dx, dy - ring[0][1] * s);
        for (let i = 1; i < ring.length; i++) {
          g.lineTo(ring[i][0] * s + dx, dy - ring[i][1] * s);
        }
        g.closePath();
      }
    }
    g.fill("evenodd");   // hullene skal sta apne
  }

  return { bilde: c.toDataURL("image/png"), bredde, hoyde, graaBunn };
}
