/**
 * Bilskisse inn, ferdige elementer ut.
 *
 * SignHub kaller denne med selve skissefila. Den far tilbake malestokken,
 * visningene, hvert dekorelement som en ren PDF med ekte millimetermal, og
 * bilskissen ferdig tegnet som bilde. Derfra er det en helt vanlig jobb:
 * bygg linjer med folie per farge og kall kjorJobb, med bilskissen som
 * forside paa kundeskissen.
 *
 * Ingenting her peker ut dekoren for hand. Reglene staar i dekorfinn.ts.
 */
import { lesLett, tolk } from "./bilskisse.ts";
import { finnDekor } from "./dekorfinn.ts";
import { hentBaner, skrivPdf } from "./uttrekk.ts";
import { hentGeometriPerFarge } from "./pdfbaner.ts";
import { tegnBilSkisse } from "./skisse_bil.ts";
import type { Bilde, LerretFabrikk } from "./skisse_kunde.ts";
import type { Folie } from "./motor.ts";

const MM = 72 / 25.4;
const A4_FORHOLD = 297 / 210;

export interface BilFarge {
  /** slik den skal skjaeres, oyverst forst */
  hex: string;
  /** andel av elementets flate, til hjelp naar folie skal velges */
  andel: number;
}

export interface BilElement {
  /** stabil nokkel innenfor denne skissen */
  id: string;
  /** hvilken visning elementet ble funnet i, f.eks. "side ovre" */
  vis: string;
  navn: string;
  /** elementet alene, som PDF. Kan sendes rett inn i kjorJobb som linje. */
  pdf: Uint8Array;
  /** ekte mal paa kjoretoyet */
  breddeMm: number;
  hoydeMm: number;
  /** samme element funnet flere steder telles her, ikke som egne elementer */
  antall: number;
  farger: BilFarge[];
}

export interface BilSkisseLest {
  /** malestokken motoren faktisk regner med */
  malestokk: number;
  /** malestokken som staar skrevet paa arket, hvis den staar der */
  malestokkTekst: number | null;
  /** hvor mye de to spriker, i prosent */
  avvikProsent: number | null;
  lengdeM: number | null;
  breddeM: number | null;
  hoydeM: number | null;
  visninger: { navn: string; breddeEkteMm: number; hoydeEkteMm: number }[];
  elementer: BilElement[];
  /** bilskissen ferdig tegnet, klar som forside paa kundeskissen */
  forside: { jpeg: Uint8Array; bredde: number; hoyde: number };
  merknader: string[];
}

export interface BilValg {
  jobb: string;
  bilder: { disclaimer: Bilde; vannmerke: Bilde };
  lerret: LerretFabrikk;
  /** bredden paa bilskissen i piksler. 1400 gir god lesbarhet paa A4. */
  bredde?: number;
}

export async function lesBilskisse(kilde: Uint8Array, v: BilValg): Promise<BilSkisseLest> {
  const lett = await lesLett(kilde);
  const s = tolk(lett);
  const malestokk = s.malt ?? s.malestokkTekst;
  if (!malestokk) {
    throw new Error("Fant ingen malestokk i skissen. Uten den kan ikke ekte mal regnes ut.");
  }
  const funn = finnDekor(lett, malestokk, { L: s.lengdeM, B: s.breddeM, H: s.hoydeM });
  const merknader = [...s.merknader, ...funn.merknader];

  const { baner } = await hentBaner(kilde);
  const andel = (b: any, o: any) => {
    const ox = Math.max(0, Math.min(b.boks.x1, o.x1) - Math.max(b.boks.x0, o.x0));
    const oy = Math.max(0, Math.min(b.boks.y1, o.y1) - Math.max(b.boks.y0, o.y0));
    return (ox * oy) / Math.max((b.boks.x1 - b.boks.x0) * (b.boks.y1 - b.boks.y0), 1e-9);
  };

  const elementer: BilElement[] = [];
  for (const o of funn.omraader) {
    const valgte = baner.filter((b) => andel(b, o) >= 0.9);
    if (!valgte.length) continue;
    const pdf = await skrivPdf(valgte);
    const per = await hentGeometriPerFarge(pdf, 1.0);
    const tegnetB = (per.bbox[2] - per.bbox[0]) / MM;
    const tegnetH = (per.bbox[3] - per.bbox[1]) / MM;
    /**
     * To like elementer skal vaere ett element i to eksemplarer, ellers
     * pakkes de hver for seg og arket blir lengre enn det trenger.
     * Samme antall baner og samme tegnede bredde er nok til a kjenne dem
     * igjen: det er den samme kunstverket, satt inn to ganger.
     */
    const nokkel = `${valgte.length}|${tegnetB.toFixed(2)}`;
    const finnes = elementer.find((e) => e.id === nokkel);
    if (finnes) { finnes.antall++; finnes.navn += ` + ${o.vis} ${o.navn}`; continue; }
    elementer.push({
      id: nokkel, vis: o.vis, navn: `${o.vis} ${o.navn}`, pdf,
      breddeMm: Math.round(tegnetB * malestokk),
      hoydeMm: Math.round(tegnetH * malestokk),
      antall: 1,
      farger: per.lag.map((l) => ({ hex: l.hex, andel: l.andel })),
    });
  }
  if (!elementer.length) merknader.push("Ingen dekor a produsere i denne skissen.");

  const forside = tegnBilSkisse(baner, {
    jobb: v.jobb, malestokk,
    visninger: funn.visninger.map((x) => ({ x0: x.x0, y0: x.y0, x1: x.x1, y1: x.y1 })),
    omraader: funn.omraader.map((o) => ({ x0: o.x0, y0: o.y0, x1: o.x1, y1: o.y1, navn: o.navn, vis: o.vis })),
    bilder: v.bilder, lerret: v.lerret, bredde: v.bredde ?? 1400, sideforhold: A4_FORHOLD,
  });

  return {
    malestokk, malestokkTekst: s.malestokkTekst, avvikProsent: s.avvikProsent,
    lengdeM: s.lengdeM, breddeM: s.breddeM, hoydeM: s.hoydeM,
    visninger: funn.visninger.map((x) => ({ navn: x.navn, breddeEkteMm: x.breddeEkteMm, hoydeEkteMm: x.hoydeEkteMm })),
    elementer, forside, merknader,
  };
}

const rgbAv = (h: string): [number, number, number] =>
  [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

/**
 * Foreslar folie per farge i ett element.
 *
 * Hvitt nederst i bunken er logoens egen bakgrunn og skal ikke skjaeres.
 * Hvitt som ligger oppa en annen farge er et ekte element, og skjaeres i
 * hvit folie og monteres oppa. Resten gaar til naermeste folie i katalogen.
 */
export function foreslaFolier(farger: BilFarge[], katalog: Folie[]): (Folie | "hull")[] {
  return farger.map((f, i) => {
    if (f.hex === "#FFFFFF" && i === farger.length - 1) return "hull";
    const a = rgbAv(f.hex);
    let beste = katalog[0], minst = Infinity;
    for (const k of katalog) {
      const b = rgbAv(k.hex ?? "#000000");
      const d = (b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2 + (b[2] - a[2]) ** 2;
      if (d < minst) { minst = d; beste = k; }
    }
    return beste;
  });
}
