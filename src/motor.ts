/**
 * Ett inngangspunkt for hele jobben.
 *
 * Inn:  bestillingslinjer med logo-PDF, bredde og antall, pluss folie.
 * Ut:   produksjonsfiler til Summa, skisse til arkiv, skisse til kunde,
 *       og tallene som trengs for a se om jobben lar seg gjore.
 *
 * Grensesnittet er med vilje smalt. Appen skal bare kalle kjorJobb().
 */
import { hentGeometri, hentGeometriPerFarge, areal, omkrets, antallHull,
         lukkGlipper, ryddFlate, kuttTrygt } from "./pdfbaner.ts";
import type { MultiPoly, Geometri, GeometriPerFarge } from "./pdfbaner.ts";
import { tynnesteDetalj } from "./tykkelse.ts";
import { pakkFritt } from "./pakk.ts";
import * as pcModul from "polygon-clipping";
const pc: any = (pcModul as any).default ?? pcModul;
import { byggProduksjonsfil, STD_GEO, MM } from "./produksjonsfil.ts";
import type { ArkValg } from "./produksjonsfil.ts";
import type { Geo, Motiv } from "./produksjonsfil.ts";
import { byggSkisse } from "./skisse.ts";
import { DISCLAIMER as DISCLAIMER_BILDE } from "./assets.ts";
import { byggKundeskisse } from "./skisse_kunde.ts";
import { snuOpp } from "./snu.ts";
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
/**
 * Renner smalere enn dette regnes som en del av formen, ikke som luft
 * mellom to former. Brukes som delta til morfologisk lukking i den lagvise
 * oppbyggingen, sa en farge som ligger i en apen renne blir lagt oppa det
 * underliggende laget i stedet for a bli skaret bort fra det.
 *
 * Merk at lukking tetter igjen apninger opp til *to ganger* delta, siden
 * formen blases ut med delta fra begge sider. SPOR_MM = 4 lukker altsa
 * renner opp til 8 mm. Malt pa Nytveit-logoen, der sporet er 2,5 mm:
 * 1 mm fanger ingenting, 2 mm fanger 99,9 prosent, 3 og 4 mm alt. Malt pa
 * en konstruert 2,5 mm renne slar det inn ved noyaktig 1,25 mm.
 *
 * Lukking skiller ikke mellom en renne inne i en form og et smalt gap
 * mellom to atskilte flater i samme lag: begge tettes nar de er smalere
 * enn to ganger delta. Virkningen er avgrenset, fordi den lukkede formen
 * bare brukes til a finne hva som ligger *under* fargene over.
 */
const SPOR_MM = 4;
/** et lag som med hullene fylt dekker saa mye av motivet, danner ytterkanten */
const RAMME_FYLL = 0.995;
/** hull smalere enn dette i snitt kan ingen kniv skjaere: tegnefeil */
const GLIPPE_MM = 0.1;

/** Fyller hull med snittbredde under GLIPPE_MM. Legger til, fjerner aldri. */
function fyllTegnefeil(flate: MultiPoly, enhetMm: number) {
  const lukket: { lengdeMm: number; breddeMm: number }[] = [];
  const ny = flate.map((p) => [p[0], ...p.slice(1).filter((h) => {
    const xs = h.map((q) => q[0]), ys = h.map((q) => q[1]);
    const lengde = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) * enhetMm;
    const bredde = (areal([[h]] as MultiPoly) * enhetMm * enhetMm) / Math.max(lengde, 1e-9);
    if (bredde >= GLIPPE_MM) return true;
    lukket.push({ lengdeMm: lengde, breddeMm: bredde });
    return false;
  })]) as MultiPoly;
  return { flate: lukket.length ? ny : flate, lukket };
}
/** Under denne blir det krevende, men mulig. */
export const ADVAR_DETALJ = 3.0;
/** Hva en oppspenning og en kjoring er verdt, malt i meter rull. */
const OPPSPENNING_M = 0.5;

/**
 * Hvilken bundle appen faktisk kjorer, pa formen "<kort-sha> <tidspunkt>".
 *
 * Plassholderen under byttes ut av .github/workflows/bygg.yml rett foer
 * esbuild kjorer. Bygger du lokalt uten det steget, staar den urort, og
 * VERSJON forteller da at bundlen ikke er stemplet. Det er med vilje: en
 * ustemplet bundle skal ikke se ut som en stemplet.
 */
export const VERSJON = "__VERSJON__";

/** true nar bundlen er bygget utenom Action-en, og altsa ikke er stemplet. */
export const USTEMPLET = VERSJON.startsWith("__");

console.log(
  USTEMPLET
    ? "SignHub-motor: ustemplet bygg (lokal kilde)"
    : `SignHub-motor ${VERSJON}`,
);

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
   *
   * "negativt" betyr at fargen ikke skjaeres i egen folie. Den skjaeres
   * negativt ut av fargen under, sa underlaget star fram der den ligger.
   * Ligger den nederst, er det ingen farge under a skjaere den ut av, og
   * da faller den bort helt.
   *
   * "hull" er det gamle navnet pa det samme valget og er utgatt. Det
   * behandles likt saa lenge appen ennaa kan sende det.
   */
  folier?: (Folie | "negativt" | "hull" | null)[];
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
  /**
   * Snur staaende elementer opp i skissen. **Standard er av.**
   *
   * Paa en bilskisse er rotasjon riktig: takelementet ligger paa siden bare
   * fordi visningen ser bilen ovenfra. Paa en vanlig skiltjobb er et
   * staaende motiv staaende med vilje, og kunden skal se det slik det skal
   * henge. Bare lesBilskisse-flyten skal snu noe, og den setter dette selv.
   */
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

/**
 * Er dette valget "skjaer ikke fargen i egen folie"?
 *
 * Verkstedet kaller det negativt: fargen skjaeres negativt ut av fargen
 * under. "hull" er det gamle navnet og er utgatt, men behandles likt saa
 * lenge appen ennaa kan sende det. Ett sted, saa de to aldri kan komme i
 * utakt.
 */
function erNegativt(v: unknown): v is "negativt" | "hull" {
  return v === "negativt" || v === "hull";
}

export interface FilFarge {
  hex: string;
  /** andel av motivets areal, 0 til 1 */
  andel: number;
  /**
   * Hvitt er tvetydig: det kan vaere hvit folie, og det kan vaere et utsnitt
   * der underlaget skal vises. Skjemaet bor sette hvite rader til
   * "negativt" som utgangspunkt, og la brukeren velge folie hvis fargen
   * faktisk skal skjaeres.
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

/**
 * Filnavn i Informativs system: mellomrom, ingen understrek, æøå skrevet
 * om. Bare tegn som ikke tales i filnavn fjernes.
 */
const filnavnDel = (s: string) =>
  s.replace(/æ/g, "ae").replace(/Æ/g, "AE")
   .replace(/ø/g, "o").replace(/Ø/g, "O")
   .replace(/å/g, "a").replace(/Å/g, "A")
   .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
   .replace(/[\\/:*?"<>|_]+/g, " ").replace(/\s+/g, " ").trim() || "Jobb";

const ROLLER = ["primær", "sekundær", "tertiær", "kvartær", "kvintær"];

interface Del { folie: Folie; flate: MultiPoly; hex: string }

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

/** Slik en farge navngis i en feilmelding: fargen, og folien den skulle skjaeres i. */
const fargenavn = (d: Del) => `${d.hex} (folie ${d.folie.kode})`;

/**
 * Separeringen kutter ogsaa, og har selv ingen anelse om hvilket element
 * den holder paa med. Navnet settes paa her, ett sted, saa ingen raa feil
 * fra hverken separeringen eller lesingen slipper ut av kjorJobb uten aa
 * si hvilken linje den gjelder.
 */
async function medNavn<T>(navn: string, f: () => Promise<T>): Promise<T> {
  try {
    return await f();
  } catch (e: any) {
    const m = String(e?.message ?? e ?? "ukjent feil");
    throw m.startsWith(navn + ":") ? e : new Error(`${navn}: ${m}`);
  }
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
    const g0 = await medNavn<Geometri | GeometriPerFarge>(l.navn, () =>
      l.folier?.length ? hentGeometriPerFarge(l.pdf, 1.0)
                       : hentGeometri(l.pdf, 1.0));
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
    const g = await medNavn(l.navn, () => hentGeometri(l.pdf, skala));

    // fargene
    const deler: Del[] = [];
    let boks = g.bbox;
    let kuttet = g.flate;
    if (l.folier?.length) {
      const per = await medNavn(l.navn, () => hentGeometriPerFarge(l.pdf, skala));
      boks = per.bbox;   // boksen omfatter alle farger, ogsa de hvite
      let venter: MultiPoly = [];
      per.lag.forEach((lag, i) => {
        const v = l.folier![i];
        if (erNegativt(v)) return;   // skjaeres ikke i egen folie
        if (!v) {                              // smelter inn i den storste
          venter = venter.length
            ? (pc.union(venter as any, lag.flate as any) as MultiPoly) : lag.flate;
          return;
        }
        deler.push({ folie: v, flate: lag.flate, hex: lag.hex });
      });
      if (!deler.length) throw new Error(`${l.navn}: alle farger er slatt av.`);
      // fargene som er slatt av smelter inn i den storste som star igjen
      if (venter.length) {
        deler[0].flate = kuttTrygt(l.navn, fargenavn(deler[0]),
          (a, b) => pc.union(a as any, b as any) as MultiPoly,
          deler[0].flate, venter);
      }
      /**
       * Fargelinjer som peker pa samme folie er ett lag, ikke flere.
       *
       * Produksjonsdelen finner laget sitt med find() pa foliekode, og
       * find stopper ved forste treff. Sto to fargelinjer pa samme folie,
       * kom bare den oyverste med i skjaerefila og den andre forsvant
       * stille. Det rettes her ved kilden, ikke ved find: lagene slas
       * sammen for lagvis oppbygging, og beholder plassen til den
       * oyverste.
       */
      /**
       * Faar alle fargelagene samme foliekode, skjaeres motivet som en
       * flate og hver eneste detalj forsvinner. Det er nesten aldri
       * meningen. Den vanligste arsaken er at appen har sendt feil liste
       * til foreslaFolier, saa alle fargene traff samme oppforing.
       *
       * Maales for sammenslaingen under, som er nettopp det som skjuler
       * symptomet ved a gjore de mange lagene til ett.
       */
      if (deler.length > 1 && new Set(deler.map((d) => d.folie.kode)).size === 1) {
        advarsler.push(
          `${l.navn}: alle ${deler.length} fargelagene har samme foliekode ` +
          `${deler[0].folie.kode}. Motivet skjaeres da som en flate, og ` +
          "detaljene forsvinner. Er det med vilje, kan du se bort fra dette.");
      }

      for (let i = 0; i < deler.length; i++) {
        for (let j = deler.length - 1; j > i; j--) {
          if (deler[j].folie.kode !== deler[i].folie.kode) continue;
          deler[i].flate = kuttTrygt(l.navn, fargenavn(deler[i]),
            (a, b) => pc.union(a as any, b as any) as MultiPoly,
            deler[i].flate, deler[j].flate);
          deler.splice(j, 1);
        }
      }

      /**
       * Fargen som danner ytterkanten legges i bunn som ett helt stykke.
       *
       * Eirik 16.11.2026, XL-logoen paa 309916: gullramme, svart rute
       * innenfor, gull XL oppaa. Tegnet slik ligger den svarte ruten i bunn
       * og gullet oppaa i to deler, og hele ytterkanten av den svarte maa
       * treffe innerkanten av gullrammen. Bommer monteringen, kommer en tynn
       * stripe fram paa en eller to sider. Legges gullet i bunn som et helt
       * rektangel og den svarte oppaa med XL skaaret ut, finnes ingen slik
       * kant: gullet ligger under alt, og en liten forskyvning gjoer bare
       * rammen litt bredere paa den ene siden.
       *
       * Kjennetegn: et lag som ikke er nederst, men som med hullene fylt
       * dekker hele motivet. Det flyttes til bunnen. Den lagvise
       * oppbyggingen under fyller det deretter til et helt stykke, og
       * laget som var nederst faar utskjaeringene fra fargene som ligger
       * oppaa det. Ingenting forsvinner: det synlige bildet er det samme.
       */
      /*
       * Regelen gjelder per oey, ikke per element. Paa panseret og bakluken
       * staar XL-boksen ved siden av PROFF i samme element. Gullet danner
       * ytterkanten av XL-boksen, men ikke av hele elementet, og den foerste
       * utgaven saa bare paa hele elementet. En farge flyttes naar den, i
       * hver oey der den ligger sammen med andre farger, dekker hele oeya.
       * Ligger den et sted oppaa en annen farge som eier kanten der, blir
       * den staaende.
       */
      if ((l.lagvis ?? true) && deler.length > 1) {
        const ytre = (f: MultiPoly) => f.map((p) => [p[0]]) as MultiPoly;
        const oyer = kuttTrygt(l.navn, "ytterkant",
          (...f) => pc.union(...(f as any[])) as MultiPoly, ...deler.map((d) => ytre(d.flate)));
        const fylt = deler.map((d) => ytre(d.flate));
        const iOy = (f: MultiPoly, oy: MultiPoly) => areal(pc.intersection(f as any, oy as any) as MultiPoly);
        const eierKant = (k: number) => {
          let treff = 0;
          for (const p of oyer) {
            const oy = [p] as MultiPoly, a = areal(oy);
            const her = iOy(fylt[k], oy);
            if (her < 1e-6 * a) continue;
            const andre = fylt.some((f, j) => j !== k && iOy(f, oy) > 1e-6 * a);
            if (!andre) continue;
            if (her < RAMME_FYLL * a) return false;
            treff++;
          }
          return treff > 0;
        };
        const k = eierKant(deler.length - 1) ? -1
          : deler.slice(0, -1).findIndex((_, i) => eierKant(i));
        if (k >= 0) {
          const [d] = deler.splice(k, 1);
          deler.push(d);
          advarsler.push(`${l.navn}: ${fargenavn(d)} danner ytterkanten og er lagt i bunn ` +
            "som ett helt stykke. Fargene over ligger innenfor den, saa ingen kant maa treffe " +
            "en annen kant ved montering.");
        }
      }

      // malene og tallene skal gjelde det som faktisk skjaeres
      kuttet = deler.length === 1 ? deler[0].flate
        : kuttTrygt(l.navn, "alle lag",
            (...f) => pc.union(...(f as any[])) as MultiPoly,
            ...deler.map((d) => d.flate));
      // lagvis: hvert lag tar med seg alt som ligger over
      const lagvis = l.lagvis ?? true;
      if (lagvis && deler.length > 1) {
        const hull = per.lag
          .filter((_, i) => erNegativt(l.folier![i]))
          .map((x) => x.flate);
        const somHull = hull.length
          ? (hull.length === 1 ? hull[0]
             : kuttTrygt(l.navn, "de negative lagene",
                 (...f) => pc.union(...(f as any[])) as MultiPoly, ...hull))
          : [];
        /**
         * Et lag fyller igjen hullene som fargene over har stanset ut av
         * det, men bare de hullene som ligger innenfor lagets egen form.
         *
         * For tok laget med seg alt som la over, ogsa det som la ved
         * siden av. Da fikk et lite tekstlag hele logoen under seg, og vi
         * la folie oppa folie uten grunn. Ligger en farge inni laget,
         * skal hullet fylles; ligger den ved siden av, skal den ikke rores.
         *
         * Lokken gar nedenfra og opp, slik at `over` alltid er de
         * uendrede lagene.
         */
        for (let i = deler.length - 1; i >= 1; i--) {
          const navn = fargenavn(deler[i]);
          const over: MultiPoly = i === 1 ? deler[0].flate
            : kuttTrygt(l.navn, navn,
                (...f) => pc.union(...(f as any[])) as MultiPoly,
                ...deler.slice(0, i).map((d) => d.flate));
          /**
           * Hele oppbyggingen av dette ene laget ligger inne i vakten,
           * ikke bare den ene operasjonen som tilfeldigvis kastet. Feiler
           * den, kjores den om igjen paa ryddet geometri, og gaar det
           * fortsatt ikke, sier feilen hvilket element og hvilken farge.
           */
          deler[i].flate = kuttTrygt(l.navn, navn, (egen, oppa, somHullNa) => {
            // renner smalere enn SPOR_MM teller som innenfor formen
            const lukket = lukkGlipper(egen, (SPOR_MM * MM) / skala);
            const fylt = lukket.map((p) => [p[0]]) as MultiPoly;
            const innenfor = pc.intersection(fylt as any, oppa as any) as MultiPoly;
            let ny: MultiPoly = innenfor.length
              ? (pc.union(egen as any, innenfor as any) as MultiPoly)
              : egen;
            if (somHullNa.length) {
              ny = pc.difference(ny as any, somHullNa as any) as MultiPoly;
            }
            // rydd bort nullbrede pigger unionen kan ha lagt igjen
            return ryddFlate(ny);
          }, deler[i].flate, over, somHull);
        }
        /**
         * Nederste lag fylles ikke blankt ut lenger.
         *
         * Regelen sto sa lenge bunnlaget faktisk la under alt annet, som
         * pa Finsas. Ligger det stort sett apent, som blaa i Nytveit, ble
         * DIN TRANSPORTOR skaret som klumper uten innmat i D, R, A, O og P.
         *
         * Lokken over fyller allerede igjen de hullene fargene over
         * dekker, og den gjelder ogsa nederste lag siden i gar fra
         * deler.length - 1. Innmat som ingen farge ligger oppa, skal
         * fortsatt skjaeres.
         */
      }
      /**
       * Glipper som ingen kniv kan skjaere er tegnefeil, og fylles igjen.
       *
       * Paa XL-logoen i 309916 naar den svarte ruten nesten, men ikke helt,
       * opp til gullrammen. Glippa er 710 mm lang og 0,01 mm bred. Med gull
       * i bunn ble den et hull i gullet, og to skjaerelinjer 0,01 mm fra
       * hverandre: en strek tvers over rektangelet.
       *
       * Dette er ikke aa fjerne noe. Glippa fylles med folie, det legges til
       * og ikke trekkes fra. Grensen er absolutt, ikke relativ til logoen:
       * den gamle restfjerningen sammenlignet med logoens stoerrelse og
       * fjernet hele bokstaver i smaa logoer. En glippe under GLIPPE_MM i
       * snittbredde kan ingen plotter skjaere som to linjer, uansett hvor
       * stor logoen er. Ekte hull er millimeter brede. Det meldes alltid.
       */
      const enhetMm = skala / MM;
      for (const d of deler) {
        const r = fyllTegnefeil(d.flate, enhetMm);
        if (!r.lukket.length) continue;
        d.flate = r.flate;
        advarsler.push(`${l.navn}: ${r.lukket.length} glippe(r) i ${fargenavn(d)} er fylt igjen, ` +
          r.lukket.map((g) => `${g.lengdeMm.toFixed(0)} mm lang og ${g.breddeMm.toFixed(2)} mm bred`).join(", ") +
          ". Det er en tegnefeil i logoen (to flater som nesten moetes). Ingenting er fjernet.");
      }
      kuttet = fyllTegnefeil(kuttet, enhetMm).flate;
      if (per.lag.length > l.folier.length) {
        advarsler.push(`${l.navn}: filen har ${per.lag.length} farger, men bare ` +
          `${l.folier.length} er tildelt folie. Resten er slatt sammen.`);
      }
    } else {
      const folie = l.folie ?? b.folie;
      if (!folie) throw new Error(`${l.navn}: mangler folie.`);
      deler.push({ folie, flate: g.flate, hex: folie.hex ?? "#000000" });
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
     * Motoren fjerner ALDRI noe fra en logo (Eirik 16.11.2026: «det er det
     * verste som kan skje»). Tidligere ble harfine biter under 1 mm og
     * 10 mm² fjernet som «rester fra subtraksjonen», men regelen kunne ikke
     * skille rester fra ekte detaljer: pa «informativ» ved 25 mm forsvant
     * hele den hvite teksten, og ved 50 mm forsvant en detalj. Na blir alt
     * staende og skjaeres, og tynne biter meldes i stedet, sa operatoren
     * ser det og kan velge storre format.
     */
    const SMAA_MM = 1.0;
    const SMAA_MM2 = 10;
    const mmPerPt = (skala * 25.4) / 72;
    let smaaBiter = 0;
    for (const d of deler) {
      for (const p of d.flate) {
        const t = (await tynnesteDetalj([p], skala)).tynnesteMm;
        const a2 = areal([p]) * mmPerPt * mmPerPt;
        if (t > 0 && t < SMAA_MM && a2 < SMAA_MM2) smaaBiter++;
      }
    }
    if (smaaBiter) {
      advarsler.push(`${l.navn}: ${smaaBiter} svaert sma og tynne biter ` +
        `(under ${SMAA_MM} mm og ${SMAA_MM2} mm²). Ingenting er fjernet, men ` +
        `de lar seg trolig ikke luke. Vurder storre format.`);
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
        /**
         * Arket faar ikke bli lengre for en folie de flyttede elementene
         * ikke bruker selv (Eirik 16.11.2026, 309916 XL-Bygg). PROFF i sort
         * ble lagt inn paa arket med gull og sort: 0,48 m mer folie totalt,
         * innenfor oppspenningens 0,5 m, men gullet ble 0,88 m lengre og
         * laa ubrukt under PROFF. Metrene havner paa en folie som kan
         * koste mange ganger mer. Siden den lille gruppens folier er en
         * ekte delmengde, finnes det alltid en slik folie, saa regelen er:
         * slaa bare sammen naar arket ikke blir lengre.
         */
        const lengdeStor = kostnad(grupper.get(stor)!) / c.size;
        const lengdeSamlet = samlet / c.size;
        const blirLengre = lengdeSamlet > lengdeStor + 1;
        if (!blirLengre && merForbruk <= (b.oppspenningM ?? OPPSPENNING_M)) {
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
  const grunnNavn = filnavnDel(b.jobb);

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

      /**
       * Én fil per folie (Eirik 16.11.2026). Wild-fila kan kjores pa bade
       * summa og wild, sa primaerfargen far bare den. Er arket for bredt for
       * wild, lages summa-varianten med doble regmarks i stedet. Filnavnet
       * sier ikke maskin, bare: navn, prosess, materiale, skala.
       */
      const varianter: { navn: string; valg: ArkValg }[] = rolleNr === 0
        ? [wildGar
            ? { navn: rolle, valg: { thruCut: true, regmark: true, dobleRegmarks: false, ytreRamme: ramme } }
            : { navn: rolle, valg: { thruCut: true, regmark: true, dobleRegmarks: true, ytreRamme: ramme } }]
        : [{ navn: rolle,
             valg: { thruCut: false, regmark: false, dobleRegmarks: false, ytreRamme: ramme } }];

      for (const v of varianter) {
        const prosess = v.valg.thruCut ? "Kiss+thru" : "Kiss";
        filer.push({
          slag: "produksjon",
          navn: `${grunnNavn} ${prosess} ${folie.kode} 100%.pdf`,
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

  /**
   * To ark kan faa samme navn: samme folie og samme prosess i to
   * fargegrupper. Paa 309916 ble sort primaer baade paa arket med gull og
   * paa arket med bare PROFF, og den ene fila skrev over den andre. Navnet
   * faar da «del 1 av 2» foer skalaen, slik filnavnsystemet sier.
   */
  const like = new Map<string, any[]>();
  for (const f of filer as any[]) if (f.slag === "produksjon") {
    if (!like.has(f.navn)) like.set(f.navn, []);
    like.get(f.navn)!.push(f);
  }
  for (const [navn, fs] of like) if (fs.length > 1) fs.forEach((f, i) => {
    f.navn = navn.replace(/ 100%\.pdf$/, ` del ${i + 1} av ${fs.length} 100%.pdf`);
  });

  if (utenWild.length) {
    advarsler.push(`For bredt for wild: ${utenWild.join(", ")}. ` +
      `Wild tar rull opp til ${grunngeo.wildMaksRull} mm og skjaerer ` +
      `${grunngeo.wildMaksSkjaer} mm. Fila har doble regmarks og ma kjores pa summa.`);
  }

  const felt: Felt = { korrekturdato: idag(), ...(b.felt ?? {}) };
  // Staaende elementer snus opp for skissen naar den som bestiller ber om
  // det. Produksjonsfilene rores ikke.
  const skisseKlar = b.snuOpp === true ? snuOpp(skisseMotiv) : skisseMotiv;
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
