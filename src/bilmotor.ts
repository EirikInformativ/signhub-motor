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
import { hentGeometriPerFarge, areal } from "./pdfbaner.ts";
import * as pcModul from "polygon-clipping";
const pc: any = (pcModul as any).default ?? pcModul;
import { tegnBilSkisse } from "./skisse_bil.ts";
import type { Bilde, LerretFabrikk } from "./skisse_kunde.ts";
import type { Folie } from "./motor.ts";

const MM = 72 / 25.4;
/**
 * Hvor mye av motivets ramme formen ma fylle for at bunnen regnes som en
 * bakgrunnsplate og ikke som et formet element. Malt: rektangulaer plate
 * 1,0000, ellipseformet badge 0,7847. Terskelen ligger hoyt med vilje, sa
 * bare en tilnaermet full firkant faller inn under den. En plate med lett
 * avrundede hjorner er fortsatt en plate; en badge er det ikke.
 */
const PLATE_FYLL = 0.995;

/**
 * Er nederste lag en bakgrunnsplate og ikke et formet element?
 *
 * En plate fyller motivets ramme: formen for den skjaeres av lagene over
 * er et rektangel som dekker hele bboksen. En badge eller et skilt er
 * formet og fyller mindre. Malt: rektangulaer plate 1,0000, ellipseformet
 * badge 0,7847.
 *
 * Eksportert for aa kunne proves direkte, uten a matte bygge en hel
 * bilskisse rundt tilfellet.
 */
export function erBakgrunnsplate(
  lag: any[], bbox: [number, number, number, number],
): boolean {
  if (lag.length < 2) return false;
  const ramme = (bbox[2] - bbox[0]) * (bbox[3] - bbox[1]);
  if (!(ramme > 0)) return false;
  const samlet = pc.union(...lag.map((f) => f as any));
  return areal(samlet) / ramme >= PLATE_FYLL;
}
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
  /**
   * fargene som skal skjaeres, oyverst forst. En bakgrunnsplate er tatt ut
   * og ligger i `bakgrunn` i stedet; den skal ikke tilbys som valg.
   */
  farger: BilFarge[];
  /**
   * bakgrunnsplaten, hvis elementet er tegnet paa en. Den er ikke dekor,
   * den er mellomrommet, og paa bilen er det lakken. Motoren trenger den i
   * PDF-en for aa bygge lagene, men den skal aldri skjaeres. Bygger du
   * folier til kjorJobb, legg til "negativt" bakerst naar denne er satt,
   * slik at listen holder folge med lagene i PDF-en.
   */
  bakgrunn?: BilFarge;
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
    /**
     * En bakgrunnsplate er ikke dekor, den er mellomrommet. Rosen-logoen
     * er tegnet paa en hvit plate som utgjor 73 prosent av motivet i 13
     * biter etter at bokstavene er skaaret fra. Meldes den som en farge
     * blant de andre, blir den foreslatt som folie, og appen tilbyr klar
     * folie over tre firedeler av logoen.
     *
     * Kjennetegn: nederste lag, og formen for den skjaeres av lagene over
     * fyller motivets ramme. Malt paa proace2 gir alle fire elementene
     * 1,0000; en ellipseformet badge gir 0,7847. Er bunnen formet, er den
     * et ekte element og blir staaende.
     */
    const alleFarger = per.lag.map((l) => ({ hex: l.hex, andel: l.andel }));
    let bakgrunn: BilFarge | undefined;
    {
      if (erBakgrunnsplate(per.lag.map((l) => l.flate), per.bbox)) {
        bakgrunn = alleFarger.pop();
        merknader.push(
          `${o.vis} ${o.navn}: bakgrunnsplaten ${bakgrunn!.hex} ` +
          `(${(bakgrunn!.andel * 100).toFixed(1)} % av motivet) er tatt ut. ` +
          "Den er ikke dekor, den er mellomrommet, og skjaeres ikke.");
      }
    }

    elementer.push({
      id: nokkel, vis: o.vis, navn: `${o.vis} ${o.navn}`, pdf,
      breddeMm: Math.round(tegnetB * malestokk),
      hoydeMm: Math.round(tegnetH * malestokk),
      antall: 1,
      farger: alleFarger,
      ...(bakgrunn ? { bakgrunn } : {}),
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

/**
 * Normaliserer en hex-farge til "#RRGGBB", eller gir null om strengen ikke
 * er en farge i det hele tatt.
 *
 * Tar imot med og uten firkantkrall, tre og seks tegn, store og sma
 * bokstaver. En funksjon i et offentlig grensesnitt skal ikke feiltolke
 * inndata i stillhet: er strengen ikke en farge, sier vi fra i stedet for
 * a gjette.
 */
export function normHex(h: unknown): string | null {
  if (typeof h !== "string") return null;
  const r = h.trim().replace(/^#/, "");
  if (/^[0-9a-fA-F]{3}$/.test(r)) {
    return ("#" + r[0] + r[0] + r[1] + r[1] + r[2] + r[2]).toUpperCase();
  }
  if (/^[0-9a-fA-F]{6}$/.test(r)) return ("#" + r).toUpperCase();
  return null;
}

const rgbAv = (h: string): [number, number, number] =>
  [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

/**
 * Foreslar folie per farge i ett element.
 *
 * Hvitt nederst i bunken er logoens egen bakgrunn og skal ikke skjaeres i
 * egen folie. Den gaar til "negativt": fargen skjaeres negativt ut av
 * fargen under, og ligger den nederst faller den bort helt. Hvitt som
 * ligger oppa en annen farge er et ekte element, og skjaeres i hvit folie
 * og monteres oppa. Resten gaar til naermeste folie i katalogen.
 */
export function foreslaFolier(farger: BilFarge[], katalog: Folie[]): (Folie | "negativt")[] {
  if (!Array.isArray(katalog) || !katalog.length) {
    throw new Error(
      "foreslaFolier: fargekatalogen er tom. Den skal inneholde folier med " +
      "kode og hex, ikke en materialliste.");
  }

  /**
   * Katalogen ma ha farger for a kunne matches paa farge. Sendes en
   * materialliste inn i stedet, med varenummer, bredde og pris men ingen
   * hex, traff alle fargene samme oppforing fordi manglende hex ble lest
   * som sort. Da fikk hele motivet en foliekode, lagene smeltet sammen, og
   * skjaerefila ble et fylt rektangel. Det skal ikke skje stille.
   */
  const brukbare: { folie: Folie; rgb: [number, number, number] }[] = [];
  const utenHex: string[] = [];
  for (const k of katalog) {
    const h = normHex(k?.hex);
    if (h) brukbare.push({ folie: k, rgb: rgbAv(h) });
    else utenHex.push(k?.kode ?? "(uten kode)");
  }

  if (!brukbare.length) {
    throw new Error(
      `foreslaFolier: ingen av de ${katalog.length} oppforingene i katalogen ` +
      "har en brukbar hex-farge. Uten farge kan folie ikke velges paa farge. " +
      "Ser listen ut som varenummer, bredde og pris, er det materiallista som " +
      "er sendt inn i stedet for fargekatalogen. " +
      `Kodene som mangler farge: ${utenHex.slice(0, 8).join(", ")}` +
      (utenHex.length > 8 ? ` og ${utenHex.length - 8} til` : ""));
  }

  if (utenHex.length) {
    console.warn(
      `foreslaFolier: hopper over ${utenHex.length} av ${katalog.length} ` +
      `folier uten brukbar hex: ${utenHex.slice(0, 8).join(", ")}` +
      (utenHex.length > 8 ? ` og ${utenHex.length - 8} til` : "") +
      ". De kan ikke velges paa farge.");
  }

  return farger.map((f, i) => {
    const fh = normHex(f?.hex);
    if (!fh) {
      throw new Error(
        `foreslaFolier: farge ${i + 1} har ingen brukbar hex ` +
        `(${JSON.stringify(f?.hex)}). Forventet "#rrggbb".`);
    }
    if (fh === "#FFFFFF" && i === farger.length - 1) return "negativt";
    const a = rgbAv(fh);
    let beste = brukbare[0].folie, minst = Infinity;
    for (const k of brukbare) {
      const d = (k.rgb[0] - a[0]) ** 2 + (k.rgb[1] - a[1]) ** 2 + (k.rgb[2] - a[2]) ** 2;
      if (d < minst) { minst = d; beste = k.folie; }
    }
    return beste;
  });
}
