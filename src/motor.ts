/**
 * Ett inngangspunkt for hele jobben.
 *
 * Inn:  bestillingslinjer med logo-PDF, bredde og antall, pluss folie.
 * Ut:   produksjonsfiler til Summa, skisse til arkiv, skisse til kunde,
 *       og tallene som trengs for a se om jobben lar seg gjore.
 *
 * Grensesnittet er med vilje smalt. Appen skal bare kalle kjorJobb().
 */
import { hentGeometri, hentGeometriPerFarge, areal, omkrets, antallHull } from "./pdfbaner.ts";
import type { MultiPoly } from "./pdfbaner.ts";
import { tynnesteDetalj } from "./tykkelse.ts";
import { pakkFritt } from "./pakk.ts";
import * as pcModul from "polygon-clipping";
const pc: any = (pcModul as any).default ?? pcModul;
import { byggProduksjonsfil, STD_GEO, MM } from "./produksjonsfil.ts";
import type { ArkValg } from "./produksjonsfil.ts";
import type { Geo, Motiv } from "./produksjonsfil.ts";
import { byggSkisse } from "./skisse.ts";
import { snuOpp } from "./snu.ts";
import { lukkGlipper } from "./pdfbaner.ts";
import { DISCLAIMER as DISCLAIMER_BILDE } from "./assets.ts";
import { byggKundeskisse } from "./skisse_kunde.ts";
import type { Bilde, KundeValg, LerretFabrikk } from "./skisse_kunde.ts";
import type { Felt, SkisseMotiv } from "./skisselayout.ts";

export { STD_GEO } from "./produksjonsfil.ts";
export { lastBilder, DISCLAIMER, VANNMERKE } from "./assets.ts";
export { forhandsvis } from "./forhandsvis.ts";
export { lesBilskisse, foreslaFolier } from "./bilmotor.ts";
export type { BilSkisseLest, BilElement, BilFarge, BilValg } from "./bilmotor.ts";
export type { Forhandsvisning, ForhandsvisValg } from "./forhandsvis.ts";
export type { Felt } from "./skisselayout.ts";

/** Under denne tynneste detaljen lar motivet seg ikke luke. */
export const MIN_DETALJ = 1.5;
/** Under denne blir det krevende, men mulig. */
export const ADVAR_DETALJ = 3.0;
/** Spor smalere enn dette regnes som noe en farge over ligger nedi. */
const SPOR_MM = 4;
/** Hva en oppspenning og en kjoring er verdt, malt i meter rull. */
const OPPSPENNING_M = 0.5;

export interface Linje {
  navn: string;
  /** logoen som PDF eller som .ai lagret PDF-kompatibelt */
  pdf: Uint8Array;
  breddeMm?: number;
  hoydeMm?: number;
  /**
   * hvilket mal som styrer. Det andre folger proporsjonalt.
   * Utelates den, styrer det maalet som er oppgitt.
   */
  styrende?: "bredde" | "hoyde";
  antall: number;
  /** folien denne linjen skjaeres i. Utelates den, brukes jobbens folie. */
  folie?: Folie;
  /**
   * Fargeseparering. En folie per farge i filen, i samme rekkefolge som
   * analyserFil() ga dem. Settes en oppforing til null, smelter den fargen
   * sammen med fargen over, sa logoen kan produseres med faerre farger.
   * Er listen utelatt, skjaeres hele motivet i én folie som for.
   */
  folier?: (Folie | null)[];
}

export interface Folie {
  /** slik den star i produksjonsfilas navn og metadata, f.eks. 751-010 */
  kode: string;
  /**
   * fargen slik den er lagret pa komponentvaren, som #rrggbb.
   * Den styrer bade skissen og fyllet i skjaerefila.
   */
  hex?: string;
  /** rullens bredde. Utelates den, brukes 1200 mm. */
  breddeMm?: number;
  /**
   * overstyrer om skissen far gra bunn. Utelates den, avgjor motoren det
   * selv ut fra hvor lys folien er.
   */
  graaBunn?: boolean;
}

export interface Bestilling {
  jobb: string;
  /**
   * Var egen vektorskisse. Den er et internt arbeidsdokument, og trengs
   * ikke naar kundeskissen er det eneste som skal ut. Standard er pa.
   */
  egenSkisse?: boolean;
  /** staaende elementer snus opp i skissen. Standard er pa. */
  snuOpp?: boolean;
  /** standardfolie for linjer som ikke har sin egen */
  folie?: Folie;
  linjer: Linje[];
  felt?: Felt;
  geo?: Partial<Geo>;
  /** hva en oppspenning er verdt i meter rull. Standard 0,5. */
  oppspenningM?: number;
  /** bildene skissene trenger, fra assets.ts. Uten dem lages ingen kundeskisse. */
  bilder?: { disclaimer: Bilde; vannmerke: Bilde };
  kundeValg?: KundeValg;
  lerret?: LerretFabrikk;
}

export interface FilFarge {
  hex: string;
  /** andel av motivets areal, 0 til 1 */
  andel: number;
  /**
   * Hvitt er tvetydig: det kan vaere hvit folie, og det kan vaere et utsnitt
   * der underlaget skal vises. Skjemaet bor sette hvite rader til "hull" som
   * utgangspunkt, og la brukeren velge folie hvis det faktisk skal skjaeres.
   */
  hvit: boolean;
}

export interface FilAnalyse {
  farger: FilFarge[];
  levendeTekst: boolean;
  /** hoyde delt pa bredde, sa skjemaet kan regne det andre malet */
  formatforhold: number;
}

/**
 * Leses ved opplasting, for a vite hvor mange materialfelt skjemaet skal vise.
 * Rask: ingen maling av tynneste detalj, ingen pakking.
 */
export async function analyserFil(pdf: Uint8Array): Promise<FilAnalyse> {
  const g = await hentGeometriPerFarge(pdf, 1.0);
  const b = g.bbox[2] - g.bbox[0];
  return {
    farger: g.lag.map((l) => ({ hex: l.hex, andel: l.andel, hvit: l.hvit })),
    levendeTekst: g.levendeTekst,
    formatforhold: b > 0 ? (g.bbox[3] - g.bbox[1]) / b : 1,
  };
}

export interface Analyse {
  navn: string;
  breddeMm: number;
  hoydeMm: number;
  antall: number;
  flater: number;
  hull: number;
  omkretsMm: number;
  arealCm2: number;
  /** omkrets delt pa areal, et grovt mal pa hvor mye luking det blir */
  oa: number;
  tynnesteMm: number;
  status: "ok" | "tynn" | "kritisk";
  minBreddeMm: number;
  levendeTekst: boolean;
  /** foliene linjen havnet pa, en per farge */
  foliekoder: string[];
}

export interface Fil {
  navn: string;
  bytes: Uint8Array;
  slag: "produksjon" | "skisse" | "kundeskisse";
}

export interface ArkInfo {
  foliekode: string;
  /** primaer, sekundaer, tertiaer ... */
  rolle: string;
  /** arkets faktiske bredde. Bare sa bredt jobben trenger. */
  breddeMm: number;
  /** rullen som skal legges i maskinen */
  rullbreddeMm: number;
  /** bredeste maskinen kan skjaere pa denne rullen */
  skjaerebreddeMm: number;
  lengdeMm: number;
  /** arket slik det skjaeres */
  kvadratmeter: number;
  /** hele rullebredden ganger lengden, om kappet ikke kan gjenbrukes */
  rullforbrukM2: number;
  elementer: number;
  roterte: number;
  regmarkSett: number;
  strategi: string;
}

export interface JobbResultat {
  analyse: Analyse[];
  /** ett ark per folie. Linjer i ulike folier kan ikke ligge pa samme rull. */
  ark: ArkInfo[];
  filer: Fil[];
  advarsler: string[];
}

/** dagens dato, dd.mm.aaaa. Korrekturdato settes nar filene lages. */
function idag(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()}`;
}

/** #rrggbb til 0..1 */
function hexTilRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "").trim();
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const n = parseInt(full.slice(0, 6), 16);
  if (!isFinite(n)) return [0, 0, 0];
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/**
 * Fargen er bare til a se pa, ikke til trykk, sa den enkle omregningen
 * holder. Den treffer hvitt og sort eksakt, og det er de to vanligste.
 */
function rgbTilCmyk(r: number, g: number, b: number): [number, number, number, number] {
  const k = 1 - Math.max(r, g, b);
  if (k >= 1 - 1e-9) return [0, 0, 0, 1];
  const rund = (v: number) => Math.round(v * 1000) / 1000;
  return [rund((1 - r - k) / (1 - k)), rund((1 - g - k) / (1 - k)),
          rund((1 - b - k) / (1 - k)), rund(k)];
}

/** Lyse folier forsvinner mot hvitt papir og trenger gra bunn i skissen. */
function erLys(r: number, g: number, b: number): boolean {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.8;
}

const slugg = (s: string) =>
  s.replace(/æ/g, "ae").replace(/Æ/g, "AE")
   .replace(/ø/g, "o").replace(/Ø/g, "O")
   .replace(/å/g, "a").replace(/Å/g, "A")
   .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
   .replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "") || "jobb";

const ROLLER = ["primær", "sekundær", "tertiær", "kvartær", "kvintær"];

interface Del { folie: Folie; flate: MultiPoly }

interface Elem {
  navn: string;
  lagvis: boolean;
  bbox: [number, number, number, number];
  skala: number;
  breddeMm: number;
  hoydeMm: number;
  antall: number;
  deler: Del[];
}

const lys = (f: Folie) => {
  const [r, g, b] = hexTilRgb(f.hex ?? "#000000");
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

export async function kjorJobb(b: Bestilling): Promise<JobbResultat> {
  const grunngeo: Geo = { ...STD_GEO, ...(b.geo ?? {}) };
  const advarsler: string[] = [];
  const analyse: Analyse[] = [];
  const skisseMotiv: SkisseMotiv[] = [];
  const elementer: Elem[] = [];
  let graaBunn = false;

  for (const l of b.linjer) {
    // Skal fargene skilles, ma boksen omfatte alle fargene, ikke bare de
    // som star igjen nar hvitt er visket bort.
    const g0 = l.folier?.length
      ? await hentGeometriPerFarge(l.pdf, 1.0)
      : await hentGeometri(l.pdf, 1.0);
    const tomt = "flate" in g0 ? !g0.flate.length : !g0.lag.length;
    if (tomt) {
      throw new Error(`${l.navn}: fant ingen baner. Er teksten gjort om til ` +
        `outlines, og er filen lagret som PDF?`);
    }

    // ett mal styrer, det andre folger av motivets egne proporsjoner
    const styrende = l.styrende ?? (l.breddeMm ? "bredde" : "hoyde");
    const onsket = styrende === "hoyde" ? l.hoydeMm : l.breddeMm;
    if (!onsket || onsket <= 0) {
      throw new Error(`${l.navn}: mangler ${styrende === "hoyde" ? "hoyde" : "bredde"} i mm.`);
    }
    const skala = (onsket * MM) /
      (styrende === "hoyde" ? g0.bbox[3] - g0.bbox[1] : g0.bbox[2] - g0.bbox[0]);

    // hele motivet, til mal og til tallene. Boksen er felles for alle farger,
    // slik at fargene havner pa noyaktig samme plass pa hvert ark.
    const g = await hentGeometri(l.pdf, skala);

    // fargene
    const deler: Del[] = [];
    let boks = g.bbox;
    let kuttet = g.flate;
    if (l.folier?.length) {
      const per = await hentGeometriPerFarge(l.pdf, skala);
      boks = per.bbox;   // boksen omfatter alle farger, ogsa de hvite
      let venter: MultiPoly = [];
      per.lag.forEach((lag, i) => {
        const v = l.folier![i];
        if (v === "hull") return;              // skjaeres ikke, star apent
        if (!v) {                              // smelter inn i den storste
          venter = venter.length
            ? (pc.union(venter as any, lag.flate as any) as MultiPoly) : lag.flate;
          return;
        }
        deler.push({ folie: v, flate: lag.flate });
      });
      if (!deler.length) throw new Error(`${l.navn}: alle farger er slatt av.`);
      /**
       * Far to fargelinjer samme folie, er de ett lag, ikke to. Filer har
       * ofte to nesten like nyanser av samme farge, og da setter brukeren
       * samme folie pa begge. Uten sammenslaingen blir bare den oyverste
       * med i skjaerefila, og lagvis oppbygging teller et lag som ikke
       * finnes. Laget beholder plassen til den oyverste av dem.
       */
      for (let i = 0; i < deler.length; i++) {
        for (let j = deler.length - 1; j > i; j--) {
          if (deler[j].folie.kode !== deler[i].folie.kode) continue;
          deler[i].flate = pc.union(deler[i].flate as any, deler[j].flate as any) as MultiPoly;
          deler.splice(j, 1);
        }
      }
      // fargene som er slatt av smelter inn i den storste som star igjen
      if (venter.length) {
        deler[0].flate = pc.union(deler[0].flate as any, venter as any) as MultiPoly;
      }
      // malene og tallene skal gjelde det som faktisk skjaeres
      kuttet = deler.length === 1 ? deler[0].flate
        : (pc.union(...deler.map((d) => d.flate as any)) as MultiPoly);
      /**
       * Lagvis oppbygging: et lag fyller igjen hullene som fargene over har
       * stanset ut av det, men bare de hullene som ligger innenfor lagets
       * egen form. Da far en farge som ligger oppa en annen full dekning
       * under seg, og registeret trenger ikke a treffe pa hundredelen.
       *
       * Det som ligger ved siden av, og ikke oppa, blir ikke med. En logo
       * der fargene star side om side skal ikke skjaeres flere ganger i
       * hver folie. Vi legger ikke folie oppa folie uten grunn.
       *
       * Skal en farge heller staa apen, for eksempel hvit tekst som skal
       * monteres pa en hvit flate, settes fargelinjen til hull. Da skjaeres
       * den ikke i egen folie, og hullet blir staaende.
       */
      const lagvis = l.lagvis ?? true;
      if (lagvis && deler.length > 1) {
        const hull = per.lag
          .filter((_, i) => l.folier![i] === "hull")
          .map((x) => x.flate);
        const somHull = hull.length
          ? (hull.length === 1 ? hull[0]
             : (pc.union(...hull.map((h) => h as any)) as MultiPoly))
          : [];
        for (let i = deler.length - 1; i >= 1; i--) {
          const over = i === 1 ? deler[0].flate
            : (pc.union(...deler.slice(0, i).map((d) => d.flate as any)) as MultiPoly);
          // egen form uten hull: alt som ligger innenfor denne, skal fylles
          // egen form uten hull, og med smale spor lukket. Et element som
          // ligger i et spor i laget under, skal legges oppa, ikke buttes
          // inntil. En glipe pa en millimeter er verre enn litt folie ekstra.
          const lukket = lukkGlipper(deler[i].flate, (SPOR_MM * MM) / skala);
          const fylt = lukket.map((p) => [p[0]]);
          const innenfor = pc.intersection(fylt as any, over as any) as MultiPoly;
          let ny = innenfor.length
            ? (pc.union(deler[i].flate as any, innenfor as any) as MultiPoly)
            : deler[i].flate;
          if (somHull.length) ny = pc.difference(ny as any, somHull as any) as MultiPoly;
          deler[i].flate = ny;
        }
        /**
         * Nederste lag fyller igjen de hullene som fargene over dekker, men
         * beholder de andre. Innmaten i en bokstav som ingen farge ligger
         * oppa, skal fortsatt skjaeres, ellers blir teksten en klump.
         * Sammenfyllingen skjer i lokken over, sammen med de andre lagene.
         */
      }
      if (per.lag.length > l.folier.length) {
        advarsler.push(`${l.navn}: filen har ${per.lag.length} farger, men bare ` +
          `${l.folier.length} er tildelt folie. Resten er slatt sammen.`);
      }
    } else {
      const folie = l.folie ?? b.folie;
      if (!folie) throw new Error(`${l.navn}: mangler folie.`);
      deler.push({ folie, flate: g.flate });
    }

    for (const d of deler) {
      const [r, gg, bl] = hexTilRgb(d.folie.hex ?? "#000000");
      if (d.folie.graaBunn ?? erLys(r, gg, bl)) graaBunn = true;
    }

    const breddeMm = ((boks[2] - boks[0]) * skala) / MM;
    const hoydeMm = ((boks[3] - boks[1]) * skala) / MM;
    const omkretsMm = (omkrets(kuttet) * skala) / MM;
    const arealCm2 = (areal(kuttet) * skala * skala) / (MM * MM) / 100;

    /**
     * Subtraksjonen mellom lagene etterlater av og til rester: harfine
     * stykker som verken lar seg luke eller lime. De skal ikke skjaeres, og
     * de skal ikke dra tynneste detalj ned og utlose falsk alarm.
     *
     * Kravet er bade tynt og lite. Et ekte element som er tynt skal fortsatt
     * meldes som kritisk, ikke fjernes i det stille.
     */
    const REST_MM = 1.0;
    const REST_MM2 = 10;
    const mmPerPt = (skala * 25.4) / 72;
    let rester = 0;
    for (const d of deler) {
      const beholdt: MultiPoly = [];
      for (const p of d.flate) {
        const t = (await tynnesteDetalj([p], skala)).tynnesteMm;
        const a2 = areal([p]) * mmPerPt * mmPerPt;
        if (t > 0 && t < REST_MM && a2 < REST_MM2) { rester++; continue; }
        beholdt.push(p);
      }
      d.flate = beholdt;
    }
    if (rester) {
      advarsler.push(`${l.navn}: ${rester} harfine rester ble fjernet fra ` +
        `skjaerefilene. De lot seg ikke luke.`);
    }

    // males pa hver folie for seg, sa en tynn sekundaerfarge ikke gar under radaren
    let tynn = (await tynnesteDetalj(kuttet, skala)).tynnesteMm;
    for (const d of deler) {
      const t = (await tynnesteDetalj(d.flate, skala)).tynnesteMm;
      if (t > 0 && t < tynn) tynn = t;
    }

    const status = tynn < MIN_DETALJ ? "kritisk" : tynn < ADVAR_DETALJ ? "tynn" : "ok";

    if (g.levendeTekst) {
      advarsler.push(`${l.navn}: filen har levende tekst. Den er lest som baner, ` +
        `men bor gjores om til outlines for produksjon.`);
    }
    if (status === "kritisk") {
      advarsler.push(`${l.navn}: tynneste detalj ${tynn.toFixed(2)} mm ved ` +
        `${breddeMm.toFixed(0)} mm bredde. Ma opp i minst ` +
        `${((breddeMm * MIN_DETALJ) / tynn).toFixed(0)} mm for a kunne skjaeres.`);
    } else if (status === "tynn") {
      advarsler.push(`${l.navn}: tynneste detalj ${tynn.toFixed(2)} mm. Krevende luking.`);
    }

    analyse.push({
      navn: l.navn, breddeMm, hoydeMm, antall: l.antall,
      flater: kuttet.length, hull: antallHull(kuttet),
      omkretsMm, arealCm2, oa: arealCm2 > 0 ? omkretsMm / 10 / arealCm2 : 0,
      tynnesteMm: tynn, status,
      minBreddeMm: tynn ? (breddeMm * MIN_DETALJ) / tynn : 0,
      levendeTekst: g.levendeTekst,
      foliekoder: deler.map((d) => d.folie.kode),
    });

    elementer.push({ navn: l.navn, lagvis: (l.lagvis ?? true) && deler.length > 1,
                     bbox: boks, skala,
                     breddeMm, hoydeMm, antall: l.antall, deler });

    const cmykAv = (f: Folie) => rgbTilCmyk(...hexTilRgb(f.hex ?? "#000000"));
    skisseMotiv.push({
      navn: l.navn, flate: kuttet, bbox: boks, breddeMm, hoydeMm,
      antall: l.antall, status, tynnesteMm: tynn,
      minBreddeMm: tynn ? (breddeMm * MIN_DETALJ) / tynn : 0,
      hex: deler[0].folie.hex ?? "#000000", cmyk: cmykAv(deler[0].folie),
      deler: deler.map((d) => ({ hex: d.folie.hex ?? "#000000",
                                 cmyk: cmykAv(d.folie), flate: d.flate })),
    });
  }

  // Elementer som deler nøyaktig samme sett folier pakkes sammen. Da far
  // fargene til samme logo identisk plassering pa hvert ark, som er det som
  // gjor at delene treffer hverandre nar folien legges pa.
  const grupper = new Map<string, Elem[]>();
  for (const e of elementer) {
    const nokkel = e.deler.map((d) => d.folie.kode).slice().sort().join("|");
    if (!grupper.has(nokkel)) grupper.set(nokkel, []);
    grupper.get(nokkel)!.push(e);
  }

  /**
   * En gruppe med faerre folier kan legges inn i en storre gruppe naar
   * foliene er en delmengde. Det sparer en oppspenning og en kjoring.
   *
   * Men det lonner seg bare naar elementet faar plass uten at arket blir
   * lengre. Blir det lengre, blir hvert eneste ark i gruppen like mye
   * lengre, ogsa de foliene elementet ikke bruker, og da er det dyrere.
   *
   * Vi gjetter ikke paa hvor grensen gaar. Vi pakker begge veier og
   * beholder den som gir minst folie.
   */
  const foliesett = (g: Elem[]) => {
    const k = new Set<string>();
    for (const e of g) for (const d of e.deler) k.add(d.folie.kode);
    return k;
  };
  const kostnad = (g: Elem[]): number => {
    const koder = foliesett(g);
    const bredder: number[] = [];
    for (const e of g) for (const d of e.deler) bredder.push(d.folie.breddeMm ?? grunngeo.foliebredde);
    const fb = Math.min(...bredder);
    const rullen = fb <= grunngeo.wildMaksRull;
    const sk = Math.min(fb - grunngeo.rullKant, rullen ? grunngeo.wildMaksSkjaer : grunngeo.summaMaksSkjaer);
    if (!(sk > 0)) return Infinity;
    const ark = pakkFritt(g.map((e) => ({
      navn: e.navn, flate: [], bbox: e.bbox, skala: e.skala,
      breddeMm: e.breddeMm, hoydeMm: e.hoydeMm, antall: e.antall,
    })), { ...grunngeo, foliebredde: fb, skjaerebredde: sk });
    /**
     * Folien kommer paa rull. Du betaler for lengden du bruker, ikke for
     * bredden, for resten av rullbredden ligger igjen uansett. Kostnaden
     * er derfor arklengde ganger antall folier i gruppen.
     */
    return ark.arklengde * koder.size;
  };

  let slaattSammen = true;
  while (slaattSammen && grupper.size > 1) {
    slaattSammen = false;
    const noklene = [...grupper.keys()];
    for (const liten of noklene) {
      for (const stor of noklene) {
        if (liten === stor || !grupper.has(liten) || !grupper.has(stor)) continue;
        const a = foliesett(grupper.get(liten)!), c = foliesett(grupper.get(stor)!);
        if (a.size >= c.size) continue;
        if (![...a].every((k) => c.has(k))) continue;
        const hver = kostnad(grupper.get(liten)!) + kostnad(grupper.get(stor)!);
        const samlet = kostnad([...grupper.get(stor)!, ...grupper.get(liten)!]);
        /**
         * Arket krympes allerede til jobben, sa et element til gjor nesten
         * alltid arket litt storre, og veksten treffer hver folie i gruppen.
         * Rent folieregnskap ville derfor aldri slaatt sammen.
         *
         * Men et eget ark koster ogsa en oppspenning og en kjoring, og den
         * tiden staar ikke i folieregnskapet. OPPSPENNING_M2 er hva en
         * oppspenning er verdt malt i folie.
         */
        const merForbruk = (samlet - hver) / 1000;   // meter rull
        if (process.env.DBGG) console.log(`  DBGG merforbruk ${merForbruk.toFixed(3)} m rull`);
        if (merForbruk <= (b.oppspenningM ?? OPPSPENNING_M)) {
          grupper.set(stor, [...grupper.get(stor)!, ...grupper.get(liten)!]);
          grupper.delete(liten);
          slaattSammen = true;
        }
      }
    }
  }

  const filer: Fil[] = [];
  const arkinfo: ArkInfo[] = [];
  const s = slugg(b.jobb);

  const utenWild: string[] = [];
  for (const gruppe of grupper.values()) {
    // foliene i gruppen, morkest forst. Kameraet leser mork folie lettest,
    // sa den morkeste barer regmarks og blir primaerfargen.
    const folier: Folie[] = [];
    for (const e of gruppe) for (const d of e.deler) {
      if (!folier.some((f) => f.kode === d.folie.kode)) folier.push(d.folie);
    }
    /**
     * Har jobben flere folier, legges de oppa hverandre, og da er oyverste
     * folie primaer. Den legges sist og er den de andre rettes inn etter.
     * Den gamle regelen om morkest farst gjelder bare enfargede jobber,
     * der det ikke finnes noen stabling a folge.
     */
    if (folier.length > 1) {
      const rekke = gruppe[0].deler.map((d) => d.folie.kode);
      folier.sort((x, y) => rekke.indexOf(x.kode) - rekke.indexOf(y.kode));
    } else {
      folier.sort((x, y) => lys(x) - lys(y));
    }

    const bredder = folier.map((f) => f.breddeMm ?? grunngeo.foliebredde);
    const foliebredde = Math.min(...bredder);
    if (Math.max(...bredder) !== foliebredde) {
      advarsler.push(`Foliene ${folier.map((f) => f.kode).join(", ")} har ulik ` +
        `rullebredde. Arkene legges etter den smaleste, ${foliebredde} mm, ` +
        `sa fargene ligger i register.`);
    }
    /**
     * Rullen trenger en fysisk margin, og maskinen har sin egen grense.
     * Skal jobben kunne kjores wild, ma hele arket legges etter wild sin
     * skjaerebredde, ellers stemmer ikke sekundaerfila pa begge maskiner.
     */
    const rullenGar = foliebredde <= grunngeo.wildMaksRull;
    const maskin = rullenGar ? grunngeo.wildMaksSkjaer : grunngeo.summaMaksSkjaer;
    const skjaerebredde = Math.min(foliebredde - grunngeo.rullKant, maskin);
    if (skjaerebredde <= 0) {
      throw new Error(`Folien ${folier[0].kode} er for smal: ${foliebredde} mm.`);
    }
    const geo: Geo = { ...grunngeo, foliebredde, skjaerebredde };

    const tilPakking: Motiv[] = gruppe.map((e) => ({
      navn: e.navn, flate: [], bbox: e.bbox, skala: e.skala,
      breddeMm: e.breddeMm, hoydeMm: e.hoydeMm, antall: e.antall,
    }));
    const ark = pakkFritt(tilPakking, geo);
    advarsler.push(...ark.feil);

    // rammen trengs bare nar flere folier skal legges oppa hverandre
    const ramme = folier.length > 1;
    /**
     * Wild males pa den ytterste skjaerelinjen, ikke pa arkmalet. Ytterst
     * ligger rammen, eller regmark-kolonnen naar det ikke er noen ramme.
     */
    const ytterstKutt = ark.breddeMm - 2 * geo.kissInset -
      (ramme ? 0 : 2 * geo.regClear);
    const wildGar = rullenGar && ytterstKutt <= geo.wildMaksSkjaer;

    folier.forEach((folie, rolleNr) => {
      const rolle = ROLLER[rolleNr] ?? `farge${rolleNr + 1}`;
      const fyll = rgbTilCmyk(...hexTilRgb(folie.hex ?? "#000000"));
      const fyllOp = `${fyll[0]} ${fyll[1]} ${fyll[2]} ${fyll[3]} k`;
      const motiver: Motiv[] = gruppe.map((e) => ({
        navn: e.navn,
        flate: e.deler.find((d) => d.folie.kode === folie.kode)?.flate ?? [],
        bbox: e.bbox, skala: e.skala, breddeMm: e.breddeMm,
        hoydeMm: e.hoydeMm, antall: e.antall,
      }));

      const varianter: { navn: string; valg: ArkValg }[] = rolleNr === 0
        ? [{ navn: `${rolle} summa`,
             valg: { thruCut: true, regmark: true, dobleRegmarks: true, ytreRamme: ramme } }]
        : [{ navn: rolle,
             valg: { thruCut: false, regmark: false, dobleRegmarks: false, ytreRamme: ramme } }];
      if (rolleNr === 0 && wildGar) {
        varianter.push({ navn: `${rolle} wild`,
                         valg: { thruCut: true, regmark: true, dobleRegmarks: false, ytreRamme: ramme } });
      }

      for (const v of varianter) {
        filer.push({
          slag: "produksjon",
          navn: `${s}_${slugg(v.navn)}_${folie.kode}.pdf`,
          bytes: undefined as any,
          _bygg: () => byggProduksjonsfil(motiver, ark, geo, fyllOp, v.navn,
                                          v.valg, b.jobb, folie.kode),
        } as any);
      }

      if (rolleNr === 0 && !wildGar) {
        utenWild.push(`${folie.kode} (${!rullenGar ? `rull ${foliebredde} mm` :
          `ytterste skjaerelinje ${ytterstKutt.toFixed(0)} mm`})`);
      }
      arkinfo.push({
        foliekode: folie.kode, rolle,
        breddeMm: ark.breddeMm, rullbreddeMm: geo.foliebredde,
        skjaerebreddeMm: skjaerebredde,
        lengdeMm: ark.arklengde,
        kvadratmeter: (ark.breddeMm * ark.arklengde) / 1e6,
        rullforbrukM2: (geo.foliebredde * ark.arklengde) / 1e6,
        elementer: ark.plasseringer.length,
        roterte: ark.plasseringer.filter((p) => p.rotated).length,
        regmarkSett: rolleNr === 0 ? ark.regY.length : 0,
        strategi: ark.strategi,
      });
    });
  }

  for (const f of filer as any[]) {
    if (f._bygg) { f.bytes = await f._bygg(); delete f._bygg; }
  }

  if (utenWild.length) {
    advarsler.push(`Wild-fil er ikke laget for ${utenWild.join(", ")}. ` +
      `Wild tar rull opp til ${grunngeo.wildMaksRull} mm og skjaerer ` +
      `${grunngeo.wildMaksSkjaer} mm. Jobben ma kjores pa summa.`);
  }

  const felt: Felt = { korrekturdato: idag(), ...(b.felt ?? {}) };
  // Staaende elementer snus opp for skissen. Produksjonsfilene rores ikke.
  const skisseKlar = b.snuOpp === false ? skisseMotiv : snuOpp(skisseMotiv);
  if (b.egenSkisse !== false) {
    const sk = await byggSkisse(skisseKlar, b.jobb, felt, graaBunn, DISCLAIMER_BILDE);
    filer.push({ slag: "skisse", navn: `${s}_skisse.pdf`, bytes: sk.bytes });
  }

  if (b.bilder) {
    const ks = await byggKundeskisse(skisseKlar, b.jobb, felt, graaBunn,
                                     b.bilder, b.kundeValg ?? {}, b.lerret);
    filer.push({ slag: "kundeskisse", navn: `${s}_skisse_kunde.pdf`, bytes: ks.pdf });
  } else {
    // Uten bilder og lerret kan kundeskissen ikke brennes til bilde. Da er
    // jobben ufullstendig, og det skal staa i klartekst, ikke forsvinne.
    advarsler.push("Kundeskisse ble ikke laget: motoren mangler bilder " +
      "(disclaimer og vannmerke) og lerret. Leveransen er ufullstendig.");
  }

  return { analyse, ark: arkinfo, filer, advarsler };
}
