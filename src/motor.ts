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
import { PDFDocument } from "pdf-lib";
import { konvekstSkall, offsetRinger } from "./ramme.ts";
import { cmykTilRgb, tilHex } from "./pdfbaner.ts";
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
/** Flere filer enn dette for under SAMLE_M2 folie: logoer tas ut av registeret. */
const MAKS_FILER = 6;
const SAMLE_M2 = 5;
/** En farge som stikker minst saa langt ut rundt fargen over, kan monteres for haand. */
const HAAND_MARGIN_MM = 3;
/** Deler av samme farge lenger fra hverandre enn dette blir egne elementer naar en logo tas ut av registeret. */
const DEL_AVSTAND_MM = 50;
/** Hvor langt en farge gaar inn under en annen naar de produseres hver for seg. */
const UNDERLAP_MM = 5;
/** Fargene overlapper under denne andelen av den minste: de kan deles. */
const DELT_OVERLAPP = 0.1;
/** Et felt dekker minst denne andelen av elementets ramme. */
const DELT_FELT = 0.2;
/** Delingen maa spare minst denne andelen av arkene. */
const DELT_SPAR = 0.3;
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
/** overlapp i skjoeten paa lange striper, mm */
const SKJOT_MM = 10;
/** stykket gaar minst saa langt forbi bilens skjoet (Eirik 16.11.2026: «minimum 3 cm») */
const SKJOT_BIL_MM = 30;
/** en stripe er minst saa mange ganger lengre enn hoy */
const STRIPE_FORHOLD = 8;
/** tekst skjoetes i mellomrom mellom bokstaver paa minst saa mye */
const TEKST_GLIPPE_MM = 3;
/** saa mye av neste bokstav stykket foer skjoeten tar med som passmerke */
const TEKST_PASS_MM = 10;
/** overmaal paa hver side av feltet som appliseres foer thru-cut */
const APPLISER_OVERMAAL_MM = 20;
/** timekost i produksjon til regnestykket for tett ark (full selvkost, 850 til 980) */
const TIMEKOST_KR = 900;
/**
 * Den tette gruppen per logo (Eirik 16.11.2026): bitene kiss-cuttes, og
 * thru-cut gaar saa mange mm utenfor og foelger formen, aldri over det som
 * skal vaere sort.
 */
const TETT_THRU_MM = 3;
/** minutter per bit som legges over for hand (Eirik 16.11.2026: ca. 5 min for Kia) */
const OVERTEIP_MIN_PER_BIT = 0.5;
/** en side er rett naar formen ligger innenfor RETT_SIDE_MM av den langs minst RETT_SIDE_ANDEL av lengden; da rettes den helt ut */
const RETT_SIDE_MM = 0.5;
const RETT_SIDE_ANDEL = 0.97;
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
  /**
   * Hva folien koster per m², inkludert laminat naar den printes. Naar
   * prisen finnes, regner motoren ut om fargen skal ut av oppsettet og
   * legges tett (Eirik 16.11.2026, refleks paa Kia PV5).
   */
  prisM2?: number;
  /**
   * Folien er et printmedium (f.eks. 3M refleks hvit). Om laget printes
   * eller skjaeres, avgjoeres av innholdet (Eirik 16.11.2026): er fargen
   * hvit, skjaeres folien som den er; har den farge, printes den.
   */
  print?: boolean;
  /**
   * Helfolieringsfolie (Avery Carmine Red o.l.). Hele felt trenger ikke
   * appliseres (Eirik 16.11.2026): stykkene thru-cuttes rett langs kanten,
   * uten kiss og uten luking, og legges paa bilen uten applikasjonstape.
   */
  helfoliering?: boolean;
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
  /** timekost i produksjon, til regnestykket for tett ark. Standard 900 kr. */
  timekostKr?: number;
  /** minutter det tar aa legge én bit over for hand. Standard 0,5. */
  overteipMinPerBit?: number;
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
/** Én flate uten hull som (nesten) fyller sitt eget konvekse skall. */
function heltKonveks(f: MultiPoly): boolean {
  if (f.length !== 1 || f[0].length !== 1) return false;
  const r = f[0][0];
  const a = Math.abs(arealRing(r));
  const skall = konvekstSkall(r.map((p) => [p[0], p[1]] as [number, number]));
  const as = Math.abs(arealRing([...skall, skall[0]]));
  return as > 0 && a / as >= 0.99;
}
/**
 * Tett ark for dyr folie (Eirik 16.11.2026, Kia PV5: gront printet paa hvit
 * refleks, 498 kr/m² pluss laminat 45). I oppsettet maa hver farge ligge i
 * samme ramme som de andre, og rammene foelger de store elementene. Det gir
 * mye folie rundt smaa biter. Alternativet: ta fargen ut av oppsettet, legg
 * bitene tett med bare thru-cut, og legg dem over for hand.
 *
 * Regnestykket per farge med pris: folie i oppsettet (arklengde x
 * rullbredde x pris) mot folie tett pluss antall biter x minutter per bit x
 * timekost. Oppsettet blir ogsaa kortere for de andre fargene naar fargen tas
 * ut; det regnes med naar deres pris er kjent. Bare naar alle bitene er hele,
 * konvekse flater uten hull (bare thru-cut, ingenting aa luke). Begge utfall
 * meldes med tallene.
 */
/**
 * Faerre produksjonsfiler (Eirik 16.11.2026, Vito: «naar vi begynner aa
 * snakke opp mot 10 produksjonsfiler med saa lite totalt areal boer man
 * vurdere tiltak for aa redusere antallet»). Hver logo med flere farger
 * faar ellers sitt eget oppsett i register, med én fil per folie. Blir det
 * mer enn MAKS_FILER filer for under SAMLE_M2 folie, tas logoer som kan
 * monteres for haand ut av registeret: hver farge legges paa det ordinaere
 * oppsettet for sin folie, og montoeren legger fargene paa hverandre etterpaa
 * (bakruta: det hvite legges paa den sorte 961-bunnen).
 *
 * En logo kan monteres for haand naar hver farge enten staar ved siden av de
 * andre, eller ligger paa en farge som stikker minst HAAND_MARGIN_MM ut paa
 * alle kanter. En smalere kant maa treffes i register (XL-boksen, Finsaas).
 * Fargen under fylles under fargen over, og der fargene moetes side om side
 * gaar fargen under UNDERLAP_MM inn under.
 */
function samleFiler(elementer: Elem[], advarsler: string[]): Elem[] {
  const filer = (es: Elem[]) => {
    const n = new Set(es.map((e) => [...new Set(e.deler.map((d) => d.folie.kode))].sort().join("|")));
    return [...n].reduce((t, k) => t + k.split("|").length, 0);
  };
  const m2 = elementer.reduce((t, e) => t + e.deler.reduce((u, d) =>
    u + areal(d.flate) * Math.pow(e.skala / MM, 2), 0) * e.antall, 0) / 1e6;
  const foer = filer(elementer);
  if (foer <= MAKS_FILER || m2 > SAMLE_M2) return elementer;
  const ut: Elem[] = [];
  const tatt: string[] = [];
  for (const e of elementer) {
    if (e.deler.length < 2 || e.trykk?.length || e.thruForm || e.deler.some((d) => d.folie.prisM2 || d.folie.print)) { ut.push(e); continue; }
    try {
      const mm = (x: number) => (x * MM) / e.skala;
      const fylt = e.deler.map((d) => pc.union(...(d.flate.map((poly) => [poly[0]]) as [any])) as MultiPoly);
      const ytre = (f: MultiPoly, d: number) => pc.union(...(offsetRinger(f.map((poly) => poly[0].slice(0, -1) as [number, number][]), d, true)
        .map((r) => [[...r, r[0]]]) as [any])) as MultiPoly;
      let ok = true;
      for (let i = 0; i < fylt.length && ok; i++) for (let j = i + 1; j < fylt.length && ok; j++) {
        const U = fylt[i], L = fylt[j];
        const ov = areal(pc.intersection(U, L));
        if (ov < 0.1 * Math.min(areal(U), areal(L))) continue;           // ved siden av
        const rund = ytre(U, mm(HAAND_MARGIN_MM));
        if (areal(pc.difference(rund, L)) > 0.02 * areal(rund)) ok = false;   // for smal kant
      }
      if (!ok) { ut.push(e); continue; }
      const u = mm(UNDERLAP_MM);
      e.deler.forEach((d, i) => {
        const over = e.deler.slice(0, i);
        let flate: MultiPoly = d.flate;
        if (over.length) {
          const O = pc.union(...(over.map((o) => o.flate) as [any])) as MultiPoly;
          // under fargene over: fylt innenfor egen form, og UNDERLAP_MM inn der de moetes
          flate = pc.union(d.flate, pc.intersection(O, pc.union(fylt[i], ytre(d.flate, u)))) as MultiPoly;
        }
        /**
         * Deler av samme farge som ligger langt fra hverandre (den roede
         * trekanten under D-en og CENTER) blir egne elementer, saa de ikke
         * deler en ramme som nesten bare er luft.
         */
        const boks = (f: MultiPoly): [number, number, number, number] => {
          const pk = f.flat(2);
          return [Math.min(...pk.map((q) => q[0])), Math.min(...pk.map((q) => q[1])),
            Math.max(...pk.map((q) => q[0])), Math.max(...pk.map((q) => q[1]))];
        };
        const klynger: MultiPoly[] = [];
        for (const poly of flate) klynger.push([poly]);
        const naer = (a: MultiPoly, b: MultiPoly) => {
          const x = boks(a), y = boks(b), g = mm(DEL_AVSTAND_MM);
          return x[0] - g <= y[2] && y[0] - g <= x[2] && x[1] - g <= y[3] && y[1] - g <= x[3];
        };
        for (let endret = true; endret;) {
          endret = false;
          for (let a = 0; a < klynger.length && !endret; a++) for (let c = a + 1; c < klynger.length && !endret; c++) {
            if (naer(klynger[a], klynger[c])) { klynger[a] = klynger[a].concat(klynger[c]); klynger.splice(c, 1); endret = true; }
          }
        }
        klynger.forEach((k, ki) => {
          const bb = boks(k);
          ut.push({ navn: `${e.navn} ${d.folie.kode}${klynger.length > 1 ? ` ${ki + 1}` : ""}`, lagvis: false, bbox: bb, skala: e.skala,
            breddeMm: ((bb[2] - bb[0]) * e.skala) / MM, hoydeMm: ((bb[3] - bb[1]) * e.skala) / MM,
            antall: e.antall, deler: [{ ...d, flate: k }], omriss: k });
        });
      });
      tatt.push(e.navn);
    } catch { ut.push(e); }
  }
  if (tatt.length) advarsler.push(`Faerre filer: ${foer} filer for ${m2.toFixed(1).replace(".", ",")} m² folie er for mange, ` +
    `saa ${tatt.length} logo${tatt.length > 1 ? "er" : ""} legges paa det ordinaere oppsettet farge for farge og monteres ` +
    `paa hverandre for haand (${tatt.join(", ")}). Naa ${filer(ut)} filer.`);
  return ut;
}

function tettArk(elementer: Elem[], grunngeo: Geo, b: Bestilling, advarsler: string[]): Elem[] {
  const timekost = b.timekostKr ?? TIMEKOST_KR, minPerBit = b.overteipMinPerBit ?? OVERTEIP_MIN_PER_BIT;
  const nokkel = (e: Elem) => e.deler.map((d) => d.folie.kode).slice().sort().join("|");
  let ut = elementer.slice();
  const lengde = (es: Elem[], geo: Geo) => es.length ? pakkFritt(es.map((e) => ({ navn: e.navn, flate: [], bbox: e.bbox,
    skala: e.skala, breddeMm: e.breddeMm, hoydeMm: e.hoydeMm, antall: e.antall, omriss: e.omriss,
    ...(e.thruForm ? { thruForm: e.thruForm } : {}) })), geo).arklengde : 0;
  const nokler = [...new Set(ut.filter((e) => e.deler.length > 1).map(nokkel))];
  for (const k of nokler) {
    const gruppe = ut.filter((e) => nokkel(e) === k);
    const folier = gruppe[0].deler.map((d) => d.folie);
    for (const f of folier.filter((x) => x.prisM2 && x.prisM2 > 0)) {
      const rull = f.breddeMm ?? grunngeo.foliebredde;
      const geo: Geo = { ...grunngeo, foliebredde: rull,
        skjaerebredde: Math.min(rull - grunngeo.rullKant, rull <= grunngeo.wildMaksRull ? grunngeo.wildMaksSkjaer : grunngeo.summaMaksSkjaer) };
      /**
       * Bitene til én logo holdes sammen (Eirik 16.11.2026): de stripes én
       * logo om gangen. Hver bit kiss-cuttes, og thru-cut gaar TETT_THRU_MM
       * utenfor og foelger formen, men aldri inn over det som skal vaere
       * sort (de andre fargene i samme element).
       */
      const biter: Elem[] = [];
      let antall = 0, alleHele = true;
      for (const e of gruppe) {
        const d = e.deler.find((x) => x.folie.kode === f.kode);
        if (!d) continue;
        if (!d.flate.every((poly) => heltKonveks([poly]))) { alleHele = false; break; }
        antall += d.flate.length * e.antall;
        const u = (TETT_THRU_MM * MM) / e.skala;
        let form: MultiPoly;
        try {
          const ytre = pc.union(...(d.flate.map((poly) => [poly[0]]) as [any])) as MultiPoly;
          /**
           * Én gruppe er ett stykke: thru-cut rundt hele logoens biter, ikke
           * rundt hver bit for seg, ellers faller de fra hverandre og maa
           * plasseres én og én. Linjen foelger bitene tett og bygger bare
           * bro over mellomrommet mellom dem (Eirik 16.11.2026: «ingen grunn
           * til at thrucuten skal gaa opp igjen paa toppene naar den allerede
           * er nede»). Morfologisk lukking med minste radius som gjoer
           * bitene til ett stykke, saa TETT_THRU_MM utenfor, minus det sorte.
           */
          const ringer = ytre.map((poly) => poly[0].map(([x, y]) => [x, y] as [number, number]));
          const tilMulti = (rs: [number, number][][]) => pc.union(...(rs.map((r) => [[...r, r[0]]]) as [any])) as MultiPoly;
          let lukket = tilMulti(ringer);
          for (let rMm = 1; lukket.length > 1 && rMm <= 200; rMm *= 1.25) {
            const r = (rMm * MM) / e.skala;
            const ut1 = offsetRinger(ringer, r);
            lukket = tilMulti(offsetRinger(tilMulti(ut1).map((poly) => poly[0] as [number, number][]), -r));
            // lukkingen kan krympe bort et smalt stykke: bitene er alltid med
            lukket = pc.union(lukket as any, ytre as any) as MultiPoly;
          }
          form = tilMulti(offsetRinger(lukket.map((poly) => poly[0] as [number, number][]), u));
          const andre = e.deler.filter((x) => x !== d).map((x) => x.flate);
          if (andre.length) form = pc.difference(form as any, ...(andre as any)) as MultiPoly;
          // bitene ligger alltid innenfor: det som er tatt bort, var sort
          form = pc.union(form as any, d.flate as any) as MultiPoly;
        } catch { alleHele = false; break; }
        const xs = form.flatMap((poly) => poly[0].map((q) => q[0])), ys = form.flatMap((poly) => poly[0].map((q) => q[1]));
        const bb: [number, number, number, number] = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
        biter.push({ navn: `${e.navn} ${f.kode}`, lagvis: false, bbox: bb, skala: e.skala,
          breddeMm: ((bb[2] - bb[0]) * e.skala) / MM, hoydeMm: ((bb[3] - bb[1]) * e.skala) / MM,
          antall: e.antall, deler: [{ ...d }], omriss: form, thruForm: form });
      }
      if (!biter.length || !alleHele) continue;
      // oppsettet beholder fargen som markering: fyll og kiss-strek, saa
      // montoeren ser hvor bitene skal (Eirik 16.11.2026)
      const uten = gruppe.map((e) => {
        const d = e.deler.find((x) => x.folie.kode === f.kode);
        const deler = e.deler.filter((x) => x.folie.kode !== f.kode);
        return { ...e, deler, lagvis: e.lagvis && deler.length > 1,
          markering: [...(e.markering ?? []), ...(d ? [{ flate: d.flate, hex: d.folie.hex ?? d.hex }] : [])] };
      }).filter((e) => e.deler.length);
      const lMed = lengde(gruppe, geo), lUten = lengde(uten, geo);
      const tettGeo: Geo = { ...geo, bleed: 0 };
      const lTett = lengde(biter, tettGeo);
      const m2 = (l: number) => (l / 1000) * (rull / 1000);
      const andre = folier.filter((x) => x.kode !== f.kode);
      const sparAndre = andre.reduce((s, x) => s + (x.prisM2 ? m2(lMed - lUten) * x.prisM2 * ((x.breddeMm ?? rull) / rull) : 0), 0);
      const kostOppsett = m2(lMed) * f.prisM2!;
      const kostTett = m2(lTett) * f.prisM2! + (antall * minPerBit / 60) * timekost - sparAndre;
      const kr = (v: number) => Math.round(v).toLocaleString("nb-NO");
      const grense = (kostOppsett - (m2(lTett) * f.prisM2! - sparAndre)) / (timekost / 60);
      const tall = `I oppsett ${kr(kostOppsett)} kr folie (${m2(lMed).toFixed(2).replace(".", ",")} m²). ` +
        `Tett ${kr(m2(lTett) * f.prisM2!)} kr (${m2(lTett).toFixed(2).replace(".", ",")} m²) pluss ${antall} biter ` +
        `x ${String(minPerBit).replace(".", ",")} min til ${kr(timekost)} kr/t = ${kr(antall * minPerBit / 60 * timekost)} kr` +
        (sparAndre ? `, minus ${kr(sparAndre)} kr spart paa de andre fargene` : "") +
        `. Grensen er ${Math.max(0, grense).toFixed(0)} minutter overteiping totalt.`;
      if (kostTett < kostOppsett) {
        ut = ut.filter((e) => !gruppe.includes(e)).concat(uten, biter);
        advarsler.push(`${f.kode}: tatt ut av oppsettet og lagt tett, én gruppe per logo med kiss rundt bitene og ` +
          `thru-cut ${TETT_THRU_MM} mm utenfor. Oppsettet viser hvor bitene skal (fyll og kiss-strek). ` +
          `Bitene legges over for hand. ${tall}`);
        break;   // gruppen er endret; neste farge vurderes ikke paa samme runde
      }
      advarsler.push(`${f.kode}: beholdt i oppsettet. ${tall}`);
    }
  }
  return ut;
}

/**
 * Spotfargene skissen hadde, fra element-PDF-ens noekkelord (skrivPdf):
 * noekkelen er hexen laget faar naar `k`-verdien leses.
 */
async function lesSpot(pdf: Uint8Array): Promise<{ hex: string; spot: Spot }[]> {
  try {
    const d = await PDFDocument.load(pdf, { ignoreEncryption: true, updateMetadata: false });
    const k = d.getKeywords() ?? "";
    const ut: { hex: string; spot: Spot }[] = [];
    for (const m of k.matchAll(/signhub-spot:([\d.,]+)=(\S+)/g)) {
      const c = m[1].split(",").map(Number);
      const [navn, tint, alt, wp, c1] = m[2].split("@");
      if (c.length !== 4 || !navn || !alt) continue;
      ut.push({ hex: tilHex(cmykTilRgb(c[0], c[1], c[2], c[3])),
        spot: { navn: decodeURIComponent(navn), tint: Number(tint), cmyk: alt.split(",").map(Number),
          ...(wp && c1 ? { lab: { wp: wp.split(",").map(Number), c1: c1.split(",").map(Number) } } : {}) } });
    }
    return ut;
  } catch { return []; }
}
const naerHex = (a: string, b: string) => {
  const x = hexTilRgb(a), y = hexTilRgb(b);
  return Math.max(...x.map((v, i) => Math.abs(v - y[i]))) <= 3 / 255;
};

/** Bilens skjoeter langs en stripe (PDF-noekkelord fra bilskissen). */
async function lesSkjoter(pdf: Uint8Array): Promise<number[]> {
  try {
    const d = await PDFDocument.load(pdf, { ignoreEncryption: true, updateMetadata: false });
    const m = /signhub-skjot:([\d.,]+)/.exec(d.getKeywords() ?? "");
    return m ? m[1].split(",").map(Number).filter((x) => x > 0 && x < 1) : [];
  } catch { return []; }
}

/** Endene en bilskisse har merket som skjult under bilen (PDF-noekkelord). */
async function lesForleng(pdf: Uint8Array): Promise<Set<string>> {
  try {
    const d = await PDFDocument.load(pdf, { ignoreEncryption: true, updateMetadata: false });
    const k = d.getKeywords() ?? "";
    const m = /signhub-forleng:([a-z,]+)/.exec(k);
    return new Set(m ? m[1].split(",").filter(Boolean) : []);
  } catch { return new Set(); }
}

/**
 * Strekker ut ender som ligger under bilen, inn i doedrommet paa et
 * Appliser+thru-ark (Eirik 16.11.2026: «strekk hekk-stripene ut slik at de
 * dekker foliebredden»). Folien er der uansett, og montoeren faar mer aa
 * skjaere til etter. Enden flyttes til naboen (kant i kant naar begge sider
 * er rette, ellers gap) eller til kanten av feltet. Bare elementer i ett
 * eksemplar, saa én plassering er ett element.
 */
function strekkUt(gruppe: Elem[], motiver: Motiv[], ark: { plasseringer: any[] }, geo: Geo, fra: number, til: number): string[] {
  const ps = ark.plasseringer;
  const meld: string[] = [];
  // feltet er hele skjaerebredden, ikke bare det elementene bruker
  const feltV = fra, feltH = til;
  const feltO = Math.min(...ps.map((p) => p.y)), feltN = Math.max(...ps.map((p) => p.y + p.h));
  // arkretning for hver side av elementet
  const retning = (rot: boolean, side: string) => (rot
    ? ({ venstre: "N", hoyre: "O", bunn: "H", topp: "V" } as any)[side]
    : ({ venstre: "V", hoyre: "H", bunn: "N", topp: "O" } as any)[side]) as "V" | "H" | "O" | "N";
  const rettMot = (q: any, mot: "V" | "H" | "O" | "N") => {
    const sd = motiver[q.id].sider; if (!sd) return false;
    // siden av naboen som vender mot oss, i naboens egen retning
    const arkSide = { V: "H", H: "V", O: "N", N: "O" }[mot];
    const idx = (["venstre", "hoyre", "bunn", "topp"] as const).findIndex((x) => retning(q.rotated, x) === arkSide);
    return idx >= 0 && sd[idx];
  };
  for (const p of ps) {
    const e = gruppe[p.id];
    if (!e.forleng?.size || e.antall !== 1 || e.deler.length !== 1) continue;
    let totalt = 0;
    for (const side of e.forleng) {
      const r = retning(p.rotated, side);
      const andre = ps.filter((q) => q !== p);
      const overlappY = (q: any) => q.y < p.y + p.h - 1e-6 && p.y < q.y + q.h - 1e-6;
      const overlappX = (q: any) => q.x < p.x + p.w - 1e-6 && p.x < q.x + q.w - 1e-6;
      const ledig = (r: "V" | "H" | "O" | "N") => {
        let fri = 0;
        if (r === "H") fri = Math.min(feltH, ...andre.filter((q) => overlappY(q) && q.x >= p.x + p.w - 1e-6)
          .map((q) => q.x - (rettMot(q, "H") ? 0 : geo.gap))) - (p.x + p.w);
        if (r === "V") fri = p.x - Math.max(feltV, ...andre.filter((q) => overlappY(q) && q.x + q.w <= p.x + 1e-6)
          .map((q) => q.x + q.w + (rettMot(q, "V") ? 0 : geo.gap)));
        if (r === "N") fri = Math.min(feltN, ...andre.filter((q) => overlappX(q) && q.y >= p.y + p.h - 1e-6)
          .map((q) => q.y - (rettMot(q, "N") ? 0 : geo.gap))) - (p.y + p.h);
        if (r === "O") fri = p.y - Math.max(feltO, ...andre.filter((q) => overlappX(q) && q.y + q.h <= p.y + 1e-6)
          .map((q) => q.y + q.h + (rettMot(q, "O") ? 0 : geo.gap)));
        return fri;
      };
      /**
       * Er det ikke plass paa den siden enden vender, men paa motsatt side,
       * skyves elementet over dit foerst, saa enden faar plassen (stykke 1 av
       * stripen bak: enden mot hjoernet laa inntil feltkanten).
       */
      const mot = ({ V: "H", H: "V", O: "N", N: "O" } as const)[r];
      if (ledig(r) < 1) {
        const skyv = ledig(mot);
        if (skyv >= 1) {
          if (mot === "H") p.x += skyv; else if (mot === "V") p.x -= skyv;
          else if (mot === "N") p.y += skyv; else p.y -= skyv;
        }
      }
      // noeyaktig til naboen eller kanten, saa endene ligger paa samme linje
      const d = ledig(r);
      if (!(d >= 1)) continue;
      // geometrien: enden flyttes d mm ut, i elementets egne enheter
      const du = (d * MM) / e.skala, b = e.bbox, tol = (0.5 * MM) / e.skala;
      const f = e.deler[0];
      const flytt = (x: number, y: number): [number, number] =>
        side === "hoyre" && x > b[2] - tol ? [x + du, y] : side === "venstre" && x < b[0] + tol ? [x - du, y]
        : side === "topp" && y > b[3] - tol ? [x, y + du] : side === "bunn" && y < b[1] + tol ? [x, y - du] : [x, y];
      /**
       * Enden foelger kantene videre i den retningen de gaar (Eirik
       * 16.11.2026), ikke vannrett: en stripe som smalner av, fortsetter aa
       * smalne av. Hjoernet flyttes langs kanten det kommer fra, innenfor
       * elementets hoeyde (bredde), saa det aldri vokser inn i naboen.
       */
      const xAkse = side === "hoyre" || side === "venstre";
      const iEnden = (x: number, y: number) => flytt(x, y)[0] !== x || flytt(x, y)[1] !== y;
      f.flate = f.flate.map((poly) => poly.map((ring) => {
        const n = ring.length - 1;   // lukket ring
        return ring.map(([x, y], i) => {
          if (!iEnden(x, y)) return [x, y] as [number, number];
          const ii = i % n;
          const nb = [ring[(ii + n - 1) % n], ring[(ii + 1) % n]].find(([qx, qy]) => !iEnden(qx, qy));
          if (nb) {
            const dx = x - nb[0], dy = y - nb[1];
            const langs = xAkse ? dx : dy, tvers = xAkse ? dy : dx;
            if (Math.abs(langs) > 1e-9 && Math.abs(tvers / langs) < 0.5) {
              const t = tvers * (du / Math.abs(langs));
              if (xAkse) return [flytt(x, y)[0], Math.min(b[3], Math.max(b[1], y + t))] as [number, number];
              return [Math.min(b[2], Math.max(b[0], x + t)), flytt(x, y)[1]] as [number, number];
            }
          }
          return flytt(x, y);
        });
      }));
      e.omriss = f.flate;
      if (side === "hoyre") b[2] += du; else if (side === "venstre") b[0] -= du;
      else if (side === "topp") b[3] += du; else b[1] -= du;
      if (side === "hoyre" || side === "venstre") e.breddeMm += d; else e.hoydeMm += d;
      motiver[p.id].bbox = b; motiver[p.id].breddeMm = e.breddeMm; motiver[p.id].hoydeMm = e.hoydeMm;
      if (r === "H") p.w += d; else if (r === "V") { p.x -= d; p.w += d; }
      else if (r === "N") p.h += d; else { p.y -= d; p.h += d; }
      totalt += d;
    }
    if (totalt) meld.push(`${e.navn}: forlenget ${Math.round(totalt)} mm i enden som gaar inn under bilen, ` +
      "for aa fylle arket. Folien er der uansett; montoeren skjaerer til ved montering.");
  }
  return meld;
}

/**
 * Hvilke sider av rammen formen ligger rett langs: [venstre, hoeyre, bunn,
 * topp]. En side er rett naar kantene som ligger paa den (innenfor
 * RETT_SIDE_MM) dekker minst RETT_SIDE_ANDEL av den.
 */
function retteSider(f: MultiPoly, b: [number, number, number, number], skala: number): [boolean, boolean, boolean, boolean] {
  const tol = (RETT_SIDE_MM * MM) / skala;
  const dekket = [0, 0, 0, 0];
  for (const poly of f) for (const r of poly) for (let i = 0; i < r.length - 1; i++) {
    const [x0, y0] = r[i], [x1, y1] = r[i + 1];
    if (Math.abs(x0 - b[0]) < tol && Math.abs(x1 - b[0]) < tol) dekket[0] += Math.abs(y1 - y0);
    if (Math.abs(x0 - b[2]) < tol && Math.abs(x1 - b[2]) < tol) dekket[1] += Math.abs(y1 - y0);
    if (Math.abs(y0 - b[1]) < tol && Math.abs(y1 - b[1]) < tol) dekket[2] += Math.abs(x1 - x0);
    if (Math.abs(y0 - b[3]) < tol && Math.abs(y1 - b[3]) < tol) dekket[3] += Math.abs(x1 - x0);
  }
  const H = b[3] - b[1], W = b[2] - b[0];
  return [dekket[0] >= RETT_SIDE_ANDEL * H, dekket[1] >= RETT_SIDE_ANDEL * H,
          dekket[2] >= RETT_SIDE_ANDEL * W, dekket[3] >= RETT_SIDE_ANDEL * W];
}

function arealRing(r: [number, number][]): number {
  let s = 0;
  for (let i = 0; i < r.length - 1; i++) s += r[i][0] * r[i + 1][1] - r[i + 1][0] * r[i][1];
  return s / 2;
}

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

interface Del {
  folie: Folie; flate: MultiPoly; hex: string;
  /** spotfargen laget hadde i skissen, til printfila */
  spot?: Spot;
}
type Spot = { navn: string; tint: number; cmyk: number[]; lab?: { wp: number[]; c1: number[] } };

/** Er laget hvitt? Paa et printmedium skjaeres det da, det printes ikke. */
function erHvitHex(hex: string): boolean {
  const [r, g, b] = hexTilRgb(hex);
  return Math.min(r, g, b) > 0.94;
}
/** Printes laget? Bare paa printmedium, og bare naar det har farge. */
const printes = (d: Del) => !!d.folie.print && !erHvitHex(d.hex);

interface Elem {
  navn: string;
  lagvis: boolean;
  bbox: [number, number, number, number];
  skala: number;
  breddeMm: number;
  hoydeMm: number;
  antall: number;
  deler: Del[];
  /** alle fargene samlet: grunnlaget for rammer som foelger formen */
  omriss: MultiPoly;
  /** sider (i elementets retning) som ligger under bilen og kan forlenges paa arket */
  forleng?: Set<string>;
  /** bilens naturlige skjoeter langs en stripe, som andel av lengden (bilskisse) */
  skjoter?: number[];
  /**
   * Tett gruppe (tettArk): thru-cut-linjen rundt bitene, i elementets
   * enheter. Bitene selv kiss-cuttes.
   */
  thruForm?: MultiPoly;
  /**
   * Fargene som er tatt ut og lagt tett, vist i oppsettet med sin fyllfarge
   * og kiss-strek, saa montoeren ser hvor de skal (Eirik 16.11.2026).
   */
  markering?: { flate: MultiPoly; hex: string }[];
  /**
   * Printet element (Eirik 16.11.2026, Facebook-merket paa Vito): fargene
   * som printes, hver for seg. Skjaerelinjen er hele elementet (deler[0]).
   */
  trykk?: { flate: MultiPoly; hex: string; spot?: Spot }[];
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
    const forleng = await lesForleng(l.pdf);
    let trykk: Elem["trykk"];
    const spotter = await lesSpot(l.pdf);
    const skjoter = await lesSkjoter(l.pdf);
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
        const sp = spotter.find((x) => naerHex(x.hex, lag.hex))?.spot;
        deler.push({ folie: v, flate: lag.flate, hex: lag.hex, ...(sp ? { spot: sp } : {}) });
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
      /**
       * Printes flere fargelag paa samme printmedium, er det ett printet
       * element: fargene printes hver for seg, og skjaerelinjen er hele
       * elementet (Eirik 16.11.2026: «facebook logo/tekst skal være print»).
       */
      const printKode = deler.find((d) => printes(d))?.folie.kode;
      /**
       * Printet element (Facebook-logoen paa Vito): hele elementet ligger paa
       * printmediet. Et enkelt, helt konvekst stykke er Print+thru og
       * haandteres som foer; alt annet printes med kiss langs formen.
       */
      if (printKode && deler.every((d) => d.folie.kode === printKode) &&
          (deler.length > 1 || !heltKonveks(deler[0].flate))) {
        trykk = deler.filter((d) => d.folie.kode === printKode && printes(d)).reverse()
          .map((d) => ({ flate: d.flate, hex: d.hex, ...(d.spot ? { spot: d.spot } : {}) }));
      }
      if (deler.length > 1 && new Set(deler.map((d) => d.folie.kode)).size === 1 && !printKode) {
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

    /**
     * Farger som ikke ligger paa hverandre, produseres hver for seg (Eirik
     * 16.11.2026, Vito: bakluka med feltet og det hvite elementet: «det er det som er kunsten
     * aa finne ut. egentlig fordi det skaper saa mye ekstra-kapp»). Lagt i
     * register maa hver farge ha et ark paa hele elementets stoerrelse, og
     * det meste blir kapp. Hver for seg trenger hver farge bare sin egen
     * ramme, og montoeren legger delene inntil hverandre.
     *
     * Bare naar fargene nesten ikke overlapper (under DELT_OVERLAPP av den
     * minste, maalt med hullene fylt), og naar det sparer minst DELT_SPAR av
     * arket. En logo der en farge ligger inni en annen (XL-boksen, Finsaas)
     * blir staaende lagvis. Der fargene moetes, gaar fargen under
     * UNDERLAP_MM inn under fargen over, saa det aldri blir en glippe.
     */
    const rammeAv = (f: MultiPoly): [number, number, number, number] => {
      const pk = f.flat(2);
      return [Math.min(...pk.map((q) => q[0])), Math.min(...pk.map((q) => q[1])),
              Math.max(...pk.map((q) => q[0])), Math.max(...pk.map((q) => q[1]))];
    };
    const bxA = (b: number[]) => (b[2] - b[0]) * (b[3] - b[1]);
    const mmAv = (b: number[]) => [((b[2] - b[0]) * skala) / MM, ((b[3] - b[1]) * skala) / MM];
    let delt = false;
    // folie med pris vurderes av tettArk, som regner paa kroner i stedet
    if (deler.length >= 2 && !trykk?.length && deler.every((d) => d.flate.length && !d.folie.prisM2)) {
      try {
        const fylt = deler.map((d) => pc.union(...(d.flate.map((poly) => [poly[0]]) as [any])) as MultiPoly);
        let overlapp = 0;
        for (let i = 0; i < fylt.length; i++) for (let j = i + 1; j < fylt.length; j++) {
          const ov = areal(pc.intersection(fylt[i], fylt[j]));
          overlapp = Math.max(overlapp, ov / Math.max(1e-9, Math.min(areal(fylt[i]), areal(fylt[j]))));
        }
        const hel = bxA(boks) * deler.length, hver = deler.reduce((t, d) => t + bxA(rammeAv(d.flate)), 0);
        // et felt: én farge er ett helt, konvekst stykke som dekker en stor
        // del av elementet (bakluka paa Vito). Logoer der fargene staar
        // sammen (ÅTG paa Kia) skal ligge i register og deles ikke.
        const felt = fylt.some((f) => f.length === 1 && f[0].length === 1 && heltKonveks(f) &&
          areal(f) >= DELT_FELT * bxA(boks));
        if (felt && overlapp < DELT_OVERLAPP && hver < (1 - DELT_SPAR) * hel) {
          const u = (UNDERLAP_MM * MM) / skala;
          const nye = deler.map((d, i) => {
            const over = deler.slice(0, i);
            if (!over.length) return d;
            const ut = offsetRinger(d.flate.map((poly) => poly[0].slice(0, -1) as [number, number][]), u, true)
              .map((r) => [[...r, r[0]]]);
            const under = pc.intersection(pc.union(...(over.map((o) => o.flate) as [any])), pc.union(...(ut as [any])));
            return { ...d, flate: pc.union(d.flate, under) as MultiPoly };
          });
          for (const d of nye) {
            const r = rammeAv(d.flate), [w, h] = mmAv(r);
            elementer.push({ navn: `${l.navn} ${d.folie.kode}`, lagvis: false, bbox: r, skala,
              breddeMm: w, hoydeMm: h, antall: l.antall, deler: [d], omriss: d.flate });
          }
          advarsler.push(`${l.navn}: fargene ligger ikke paa hverandre og produseres hver for seg ` +
            `(${nye.map((d) => d.folie.kode).join(", ")}). Sparer ${Math.round((1 - hver / hel) * 100)} % av arkene. ` +
            "Montoeren legger delene inntil hverandre" + (overlapp > 0 ? `, med ${UNDERLAP_MM} mm under der de moetes.` : "."));
          delt = true;
        }
      } catch { /* da staar elementet lagvis som foer */ }
    }
    if (!delt) elementer.push({ navn: l.navn, lagvis: (l.lagvis ?? true) && deler.length > 1,
                     bbox: boks, skala,
                     breddeMm, hoydeMm, antall: l.antall, deler, omriss: kuttet,
                     ...(forleng.size ? { forleng } : {}), ...(skjoter.length ? { skjoter } : {}),
                     ...(trykk?.length ? { trykk } : {}) });

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
  // dyr folie: ut av oppsettet og tett, naar det er billigere enn tiden det
  // tar aa legge bitene over for hand
  const vurdert = tettArk(samleFiler(elementer, advarsler), grunngeo, b, advarsler);
  const grupper = new Map<string, Elem[]>();
  for (const e of vurdert) {
    /**
     * De tette logogruppene faar eget ark (Eirik 16.11.2026): de kiss-cuttes,
     * lukes og legges over paa det sorte oppsettet, mens stripene har sin
     * egen fil (Appliser+thru). De skal aldri paa samme ark.
     */
    const nokkel = e.deler.map((d) => d.folie.kode).slice().sort().join("|") + (e.thruForm ? "|tett" : "");
    if (!grupper.has(nokkel)) grupper.set(nokkel, []);
    grupper.get(nokkel)!.push(e);
  }

  /**
   * Lange striper skjoetes etter rullbredden, eller skjaeres hele hvis det
   * gir kortere ark (Eirik 16.11.2026, Kia PV5 310079: den gronne stripen
   * er 2,6 m lang og 0,1 m hoy). En stripe som er lengre enn det som faar
   * plass paa tvers av rullen, maa ellers ligge paa langs, og da blir arket
   * minst like langt som stripen, for begge foliene i gruppen.
   *
   * Kandidat: ett lag, en flate uten hull, lengste side over det som faar
   * plass paa tvers, og minst STRIPE_FORHOLD ganger saa lang som hoy. Den
   * deles i like lange stykker med SKJOT_MM overlapp. Gruppen pakkes begge
   * veier, og den korteste vinner. Skjoetingen meldes alltid.
   */
  for (const [nokkel, g] of grupper) {
    const fb = Math.min(...g.flatMap((e) => e.deler.map((d) => d.folie.breddeMm ?? grunngeo.foliebredde)));
    const sk = Math.min(fb - grunngeo.rullKant,
      fb <= grunngeo.wildMaksRull ? grunngeo.wildMaksSkjaer : grunngeo.summaMaksSkjaer);
    const maksLengde = sk - 2 * grunngeo.bleed - 2 * (grunngeo.kissInset + grunngeo.regClear + grunngeo.regmarkD);
    const lengde = (es: Elem[]) => pakkFritt(es.map((e) => ({ navn: e.navn, flate: [], bbox: e.bbox,
      skala: e.skala, breddeMm: e.breddeMm, hoydeMm: e.hoydeMm, antall: e.antall, omriss: e.omriss })),
      { ...grunngeo, foliebredde: fb, skjaerebredde: sk }).arklengde;
    /*
     * Foerst skjoetes alle kandidatene, saa proeves hver av dem hel igjen.
     * Proeves de en og en mot de andre hele, skjuler den lengste stripen
     * gevinsten for de kortere: stripen bak paa Kia (1,5 m) ble skaaret hel
     * fordi stripene paa sidene (2,6 m) uansett gjorde arket langt.
     */
    const biterAv = new Map<Elem, Elem[]>();
    const erTekst = new Set<Elem>();
    const bilskjot = new Set<Elem>();
    for (const e of g) {
      const lang = Math.max(e.breddeMm, e.hoydeMm), kort = Math.min(e.breddeMm, e.hoydeMm);
      const f = e.deler.length === 1 ? e.deler[0].flate : [];
      if (!(f.length && lang > maksLengde && lang >= STRIPE_FORHOLD * kort)) continue;
      const langsX = e.breddeMm >= e.hoydeMm;
      const [b0, b1] = langsX ? [e.bbox[0], e.bbox[2]] : [e.bbox[1], e.bbox[3]];
      const mmTil = (mm: number) => (mm * MM) / e.skala;
      const lengdeMm = (a: number, z: number) => ((z - a) * e.skala) / MM;
      /** stykkene som [fra, til] langs elementet */
      let stykker: [number, number][] | null = null;
      /**
       * Har bilen en naturlig skjoet langs stripen (doerskjoeten), skjoetes
       * stripen der, og hvert stykke gaar minst SKJOT_BIL_MM inn paa den
       * andre siden (Eirik 16.11.2026, Vito: «minimum 3 cm»). Montoeren
       * legger skjoeten i bilens egen skjoet. Det velges faerrest mulig
       * skjoeter som gir stykker som faar plass paa tvers.
       */
      if (f.length === 1 && f[0].length === 1 && e.skjoter?.length) {
        const ov = mmTil(SKJOT_BIL_MM);
        const steder = e.skjoter.map((x) => b0 + x * (b1 - b0));
        const ok = (kutt: number[]) => {
          const g = [b0, ...kutt, b1];
          return g.slice(1).every((z, i) => lengdeMm(Math.max(b0, g[i] - (i ? ov : 0)), Math.min(b1, z + (i < g.length - 2 ? ov : 0))) <= maksLengde);
        };
        // alle delmengder av skjoetene, faerrest og jevnest foerst
        let beste: number[] | null = null;
        const n = steder.length;
        for (let maske = 1; maske < (1 << Math.min(n, 10)); maske++) {
          const kutt = steder.filter((_, i) => maske & (1 << i));
          if (!ok(kutt)) continue;
          const g = [b0, ...kutt, b1];
          const ujevn = Math.max(...g.slice(1).map((z, i) => z - g[i]));
          const bg = beste ? [b0, ...beste, b1] : null;
          if (!beste || kutt.length < beste.length ||
              (kutt.length === beste.length && ujevn < Math.max(...bg!.slice(1).map((z, i) => z - bg![i])))) beste = kutt;
        }
        /**
         * Stripen legges paa langs av rullen og deles bare i to, i den
         * skjoeten som ligger naermest midten (Eirik 16.11.2026: «legge
         * stripene paa langs av rullen men kun delt paa 2»). Faerre stykker
         * er faerre skjoeter aa treffe; stykkene trenger ikke faa plass paa
         * tvers.
         */
        const midt = (b0 + b1) / 2;
        const naermest = steder.slice().sort((x, y) => Math.abs(x - midt) - Math.abs(y - midt))[0];
        if (naermest !== undefined && (!beste || beste.length > 1)) beste = [naermest];
        if (beste) {
          const g = [b0, ...beste, b1];
          stykker = g.slice(1).map((z, i) => [Math.max(b0, g[i] - (i ? ov : 0)), Math.min(b1, z + (i < g.length - 2 ? ov : 0))] as [number, number]);
          bilskjot.add(e);
        }
      }
      if (!stykker && f.length === 1 && f[0].length === 1) {
        // en stripe: like lange stykker med SKJOT_MM overlapp
        const n = Math.ceil(lang / maksLengde);
        const steg = (b1 - b0) / n, ov = mmTil(SKJOT_MM / 2);
        stykker = [];
        for (let i = 0; i < n; i++) stykker.push([Math.max(b0, b0 + i * steg - ov), Math.min(b1, b0 + (i + 1) * steg + ov)]);
      } else {
        /**
         * En tekst skjoetes i mellomrommet mellom to bokstaver (Eirik
         * 16.11.2026: «det er jo plenty av mellomrom mellom bokstaver»).
         * Stykket foer skjoeten tar med TEKST_PASS_MM av neste bokstav som
         * passmerke: montoeren legger neste stykke slik at bokstaven dekker
         * stubben. Skjoeten synes ikke paa bilen.
         */
        const iv = f.map((poly) => {
          const v = poly[0].map((q) => (langsX ? q[0] : q[1]));
          return [Math.min(...v), Math.max(...v)] as [number, number];
        }).sort((a, b) => a[0] - b[0]);
        const glipper: [number, number][] = [];
        let slutt = iv[0][1];
        for (const [a, z] of iv.slice(1)) {
          if (a - slutt >= mmTil(TEKST_GLIPPE_MM)) glipper.push([slutt, a]);
          slutt = Math.max(slutt, z);
        }
        const pass = mmTil(TEKST_PASS_MM);
        for (let n = Math.ceil(lang / maksLengde); n <= 6 && glipper.length && !stykker; n++) {
          const kutt: [number, number][] = [];
          for (let i = 1; i < n; i++) {
            const maal = b0 + (i * (b1 - b0)) / n;
            const best = glipper.slice().sort((x, y) => Math.abs((x[0] + x[1]) / 2 - maal) - Math.abs((y[0] + y[1]) / 2 - maal))[0];
            if (!kutt.some((k) => k === best)) kutt.push(best);
          }
          kutt.sort((x, y) => x[0] - y[0]);
          const forslag: [number, number][] = [];
          let fra = b0;
          for (const [, g1] of kutt) { forslag.push([fra, g1 + pass]); fra = g1; }
          forslag.push([fra, b1]);
          if (forslag.every(([a, z]) => lengdeMm(a, z) <= maksLengde)) { stykker = forslag; erTekst.add(e); }
        }
      }
      if (!stykker || stykker.length < 2) continue;
      const n = stykker.length;
      const biter: Elem[] = [];
      for (let i = 0; i < n; i++) {
        const [a, z] = stykker[i];
        const rute: MultiPoly = langsX
          ? [[[[a, e.bbox[1] - 1], [z, e.bbox[1] - 1], [z, e.bbox[3] + 1], [a, e.bbox[3] + 1], [a, e.bbox[1] - 1]]]]
          : [[[[e.bbox[0] - 1, a], [e.bbox[2] + 1, a], [e.bbox[2] + 1, z], [e.bbox[0] - 1, z], [e.bbox[0] - 1, a]]]];
        const bit = pc.intersection(f as any, rute as any) as MultiPoly;
        const xs = bit.flatMap((p) => p[0].map((q) => q[0])), ys = bit.flatMap((p) => p[0].map((q) => q[1]));
        /**
         * Stykkene beholder hele elementets hoeyde paa tvers og faar
         * rektangulaere rammer (Eirik 16.11.2026: «det er fordel at thrucuten
         * matcher hverandre slik at det blir enklere aa treffe»). Da ligger
         * thru-cut-kantene paa begge sider av skjoeten paa samme linje, og
         * montoeren kan legge stykkene etter kanten.
         */
        const bb: [number, number, number, number] = langsX
          ? [Math.min(...xs), e.bbox[1], Math.max(...xs), e.bbox[3]]
          : [e.bbox[0], Math.min(...ys), e.bbox[2], Math.max(...ys)];
        biter.push({ ...e, navn: `${e.navn} skjoet ${i + 1} av ${n}`, bbox: bb,
          breddeMm: ((bb[2] - bb[0]) * e.skala) / MM, hoydeMm: ((bb[3] - bb[1]) * e.skala) / MM,
          deler: [{ ...e.deler[0], flate: bit }], omriss: [],
          // bare de ytterste stykkene arver endene som kan forlenges
          forleng: new Set([...(e.forleng ?? [])].filter((sd) =>
            langsX ? (sd === "venstre" && i === 0) || (sd === "hoyre" && i === n - 1)
                   : (sd === "bunn" && i === 0) || (sd === "topp" && i === n - 1))) });
      }
      biterAv.set(e, biter);
    }
    if (!biterAv.size) continue;
    const hel = new Set<Elem>();
    const sett = () => g.flatMap((e) => biterAv.has(e) && !hel.has(e) ? biterAv.get(e)! : [e]);
    for (const e of biterAv.keys()) {
      if (bilskjot.has(e)) continue;   // skjoetes alltid i bilens skjoet (Eirik 16.11.2026)
      const delt = lengde(sett());
      hel.add(e);
      const helL = lengde(sett());
      if (!(helL <= delt)) hel.delete(e);
    }
    for (const [e, biter] of biterAv) {
      const lang = Math.max(e.breddeMm, e.hoydeMm);
      advarsler.push(hel.has(e)
        ? `${e.navn}: ${lang.toFixed(0)} mm lang ${erTekst.has(e) ? "tekst" : "stripe"} skjaeres hel; skjoeting ville ikke gjort arket kortere.`
        : erTekst.has(e)
          ? `${e.navn}: ${lang.toFixed(0)} mm lang tekst er skjoetet i ${biter.length} stykker i mellomrommet mellom bokstavene. ` +
            `Hvert stykke tar med ${TEKST_PASS_MM} mm av neste bokstav som passmerke: legg neste stykke slik at bokstaven dekker stubben.`
          : bilskjot.has(e)
            ? `${e.navn}: ${lang.toFixed(0)} mm lang stripe er skjoetet i ${biter.length} stykker i bilens egen skjoet. ` +
              `Hvert stykke gaar ${SKJOT_BIL_MM} mm inn paa den andre siden av skjoeten.`
            : `${e.navn}: ${lang.toFixed(0)} mm lang stripe er skjoetet i ${biter.length} stykker med ${SKJOT_MM} mm overlapp.`);
    }
    grupper.set(nokkel, sett());
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
      breddeMm: e.breddeMm, hoydeMm: e.hoydeMm, antall: e.antall, omriss: e.omriss,
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
        if (liten.endsWith("|tett") || stor.endsWith("|tett")) continue;
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
    /**
     * Bare thru-cut (Eirik 16.11.2026, Kia PV5 del 2 av 2: stripestykker i
     * gront). Er arket én folie og hvert element én hel, konveks flate uten
     * hull, er elementet selve stykket som skal ut. Det er ingenting aa luke,
     * saa folien appliseres og elementene thru-cuttes direkte langs kanten.
     * Uten kiss trengs heller ingen regmarks, for det er bare én oppgave paa
     * summaen. Ingen bleed: kanten ER kuttet.
     */
    // helfolieringsfolie: hver flate er selve stykket, ogsaa naar den ikke er konveks
    const helfol = folier.length === 1 && !!folier[0].helfoliering &&
      gruppe.every((e) => e.deler.length === 1 && !e.trykk && e.deler[0].flate.every((p) => p.length === 1));
    const kunThru = helfol || (folier.length === 1 &&
      gruppe.every((e) => e.deler.length === 1 && !e.trykk && (e.thruForm || heltKonveks(e.deler[0].flate))));
    /**
     * Printet folie: samme tette ark, men med regmarks og utfallende print.
     * Materialet sier om det KAN printes; innholdet avgjoer (Eirik
     * 16.11.2026): hvitt skjaeres, farge printes.
     */
    const printThru = kunThru && gruppe.some((e) => printes(e.deler[0]));
    // tette grupper (tettArk) har kiss rundt bitene: to oppgaver, saa regmarks
    const medKiss = kunThru && gruppe.some((e) => e.thruForm);
    const regThru = printThru || medKiss;
    /**
     * Appliser+thru gaar bare paa summa og har ingen regmarks: hele
     * skjaerebredden brukes (Eirik 16.11.2026: «du bruker jo fortsatt ikke
     * full skjaerebredde»). Det er rullen minus rullkanten, innenfor summa,
     * minus overmaalet paa feltet.
     */
    const geo: Geo = regThru
      ? { ...grunngeo, foliebredde, skjaerebredde, bleed: 0 }
      : kunThru
      ? { ...grunngeo, foliebredde, bleed: 0, kissInset: 0, regClear: 0, regmarkD: 0, regmarkKiss: 0,
          skjaerebredde: Math.min(foliebredde - grunngeo.rullKant, grunngeo.summaMaksSkjaer) - 2 * APPLISER_OVERMAAL_MM }
      : { ...grunngeo, foliebredde, skjaerebredde };

    /**
     * Kant i kant krever at sidene er helt rette: to linjer som avviker
     * en brøkdel av en millimeter er nettopp kniven i nesten samme spor. En
     * side som ligger innenfor RETT_SIDE_MM av rammen, rettes derfor helt ut
     * til rammen. Det flytter kanten utover, aldri innover: det legges til
     * folie, ingenting trekkes fra.
     */
    if (kunThru) for (const e of gruppe) {
      if (e.thruForm) continue;
      const d = e.deler[0];
      const tol = (RETT_SIDE_MM * MM) / e.skala, b = e.bbox;
      const sider = retteSider(d.flate, b, e.skala);
      d.flate = d.flate.map((poly) => poly.map((r) => r.map(([x, y]) => [
        sider[0] && Math.abs(x - b[0]) < tol ? b[0] : sider[1] && Math.abs(x - b[2]) < tol ? b[2] : x,
        sider[2] && Math.abs(y - b[1]) < tol ? b[1] : sider[3] && Math.abs(y - b[3]) < tol ? b[3] : y,
      ] as [number, number])));
      // alle fire sider rette: tegnes paa nytt som et eksakt rektangel paa rammens maal
      if (sider.every(Boolean)) d.flate = [[[[b[0], b[1]], [b[2], b[1]], [b[2], b[3]], [b[0], b[3]], [b[0], b[1]]]]];
    }
    const kantKiss = !kunThru && gruppe.length > 1 && gruppe.every((e) => !e.thruForm && !e.markering?.length);
    const tilPakking: Motiv[] = gruppe.map((e) => ({
      navn: e.navn, flate: [], bbox: e.bbox, skala: e.skala,
      breddeMm: e.breddeMm, hoydeMm: e.hoydeMm, antall: e.antall, omriss: e.omriss,
      ...(e.thruForm ? { thruForm: e.thruForm } : {}),
      ...(kunThru ? { sider: e.thruForm ? [false, false, false, false] as [boolean, boolean, boolean, boolean]
        : retteSider(e.deler[0].flate, e.bbox, e.skala) }
        /**
         * Kiss+thru med rektangulaere rammer legges kant i kant, som
         * klebemerkene (Eirik 16.11.2026: «1 veis kjoering av thru»). Thru
         * blir rette linjer tvers over arket, skaaret én gang, og kiss-boksen
         * ligger innenfor rammen. Formede rammer brukes bare naar de gir
         * kortere ark.
         */
        : kantKiss ? { sider: [true, true, true, true] as [boolean, boolean, boolean, boolean] } : {}),
    }));
    const ark = pakkFritt(tilPakking, geo);
    advarsler.push(...ark.feil);
    const kantIKant = kantKiss && ark.strategi.startsWith("kant i kant");
    if (kunThru) {
      // feltet er skjaerebredden innenfor regmark-kolonnene (ingen paa Appliser+thru)
      const reservert = geo.kissInset + geo.regClear + (geo.regmarkD + 2 * geo.regmarkKiss) + geo.regClear;
      // med regmarks staar arkbredden og regmark-kolonnene fast: strekk innenfor dem
      advarsler.push(...strekkUt(gruppe, tilPakking, ark, geo, reservert,
        regThru ? ark.breddeMm - reservert : reservert + ark.brukbarBredde));
    }
    /**
     * Appliser+thru: arket ER feltet som skal appliseres. Det legges rundt
     * elementene med APPLISER_OVERMAAL_MM paa hver side og rundes opp til
     * hele 10 mm, og elementene flyttes inn fra nullpunktet tilsvarende.
     * Ingen regmark-marger, for det er ingen regmarks.
     */
    if (kunThru && !regThru && ark.plasseringer.length) {
      const ps = ark.plasseringer;
      const x0 = Math.min(...ps.map((p) => p.x)), y0 = Math.min(...ps.map((p) => p.y));
      const x1 = Math.max(...ps.map((p) => p.x + p.w)), y1 = Math.max(...ps.map((p) => p.y + p.h));
      const dx = APPLISER_OVERMAAL_MM - x0, dy = APPLISER_OVERMAAL_MM - y0;
      for (const p of ps) { p.x += dx; p.y += dy; }
      ark.breddeMm = Math.ceil((x1 - x0 + 2 * APPLISER_OVERMAAL_MM) / 10) * 10;
      ark.arklengde = Math.ceil((y1 - y0 + 2 * APPLISER_OVERMAAL_MM) / 10) * 10;
      ark.regY = []; ark.regBokser = [];
      if (!helfol && ark.breddeMm > foliebredde) advarsler.push(`Feltet som skal appliseres er ${ark.breddeMm} mm bredt, ` +
        `bredere enn folien (${foliebredde} mm).`);
    }

    // ingen ytre kiss-ramme helt ytterst paa arket (Eirik 16.11.2026: «det
    // trenger ikke vaere en ytre kiss-cut ramme paa helt paa utsiden»)
    const ramme = false;
    /**
     * Wild males pa den ytterste skjaerelinjen, ikke pa arkmalet. Ytterst
     * ligger rammen, eller regmark-kolonnen naar det ikke er noen ramme.
     */
    const ytterstKutt = ark.breddeMm - 2 * geo.kissInset -
      (ramme ? 0 : 2 * geo.regClear);
    const wildGar = rullenGar && ytterstKutt <= geo.wildMaksSkjaer;

    folier.forEach((folie, rolleNr) => {
      const rolle = ROLLER[rolleNr] ?? `farge${rolleNr + 1}`;
      /**
       * Elementene fylles med skjermfargen, foliens hex som rgb, og streken
       * er CutContour. Én bane per flate: fyll og strek i samme B*, aldri en
       * fylt og en streket kopi oppaa hverandre (wild skjaerer begge).
       */
      const [fr, fg, fb2] = hexTilRgb(folie.hex ?? "#000000");
      const fyllOp = `${fr.toFixed(4)} ${fg.toFixed(4)} ${fb2.toFixed(4)} rg`;
      const rgbOp = (hex: string) => { const [a, c, d] = hexTilRgb(hex); return `${a.toFixed(4)} ${c.toFixed(4)} ${d.toFixed(4)} rg`; };
      const motiver: Motiv[] = gruppe.map((e) => ({
        navn: e.navn,
        flate: e.deler.find((d) => d.folie.kode === folie.kode)?.flate ?? [],
        bbox: e.bbox, skala: e.skala, breddeMm: e.breddeMm,
        hoydeMm: e.hoydeMm, antall: e.antall,
        ...(e.thruForm ? { thruForm: e.thruForm } : {}),
        ...(e.trykk?.length ? { trykk: e.trykk.map((t) => ({ flate: t.flate, fyllOp: rgbOp(t.hex), ...(t.spot ? { spot: t.spot } : {}) })) } : {}),
        // markeringen av det som er lagt tett, bare paa primaerarket
        ...(rolleNr === 0 && e.markering?.length
          ? { markering: e.markering.map((m) => ({ flate: m.flate, fyllOp: rgbOp(m.hex) })) } : {}),
      }));
      /**
       * Printfila bruker spotfargen fra skissen (Eirik 16.11.2026: «ikke
       * skjermfarger, men den faktiske fargekoden»), naar alle lagene i
       * folien har samme spotfarge.
       */
      const spotter = gruppe.map((e) => e.deler.find((d) => d.folie.kode === folie.kode)).filter(Boolean)
        .filter((d) => printes(d!)).map((d) => d!.spot);
      const spot = printThru && spotter.length && spotter.every((x) => x && x.navn === spotter[0]!.navn)
        ? spotter[0]! : undefined;
      if (printThru && !spot) advarsler.push(`${folie.kode}: skissen har ingen spotfarge for det som printes; ` +
        `printfila bruker skjermfargen ${folie.hex ?? ""}. Sjekk fargen foer print.`);

      /**
       * Én fil per folie (Eirik 16.11.2026). Wild-fila kan kjores pa bade
       * summa og wild, sa primaerfargen far bare den. Er arket for bredt for
       * wild, lages summa-varianten med doble regmarks i stedet. Filnavnet
       * sier ikke maskin, bare: navn, prosess, materiale, skala.
       */
      const varianter: { navn: string; valg: ArkValg }[] = kunThru
        ? [{ navn: rolle, valg: { thruCut: true, regmark: regThru, dobleRegmarks: regThru && !wildGar, ytreRamme: false, kunThru: true,
            print: printThru, ...(helfol ? { helfoliering: true } : {}), ...(spot ? { spot } : {}) } }]
        : rolleNr === 0
        ? [wildGar
            ? { navn: rolle, valg: { thruCut: true, regmark: true, dobleRegmarks: false, ytreRamme: ramme, ...(kantIKant ? { kantIKant: true } : {}) } }
            : { navn: rolle, valg: { thruCut: true, regmark: true, dobleRegmarks: true, ytreRamme: ramme, ...(kantIKant ? { kantIKant: true } : {}) } }]
        : [{ navn: rolle,
             valg: { thruCut: false, regmark: false, dobleRegmarks: false, ytreRamme: ramme, ...(kantIKant ? { kantIKant: true } : {}) } }];

      for (const v of varianter) {
        /**
         * Appliser+thru (Eirik 16.11.2026): folien appliseres paa et felt
         * foerst, saa thru-cuttes elementene. Ingen kiss, ingen luking. Feltet
         * staar i navnet, saa produksjonen ser hva som skal appliseres foer
         * fila aapnes.
         */
        const harTrykk = gruppe.some((e) => e.trykk?.length);
        const prosess = v.valg.print ? (medKiss ? "Print+kiss+thru" : "Print+thru")
          : helfol && v.valg.kunThru ? "Thru"
          : v.valg.kunThru ? (medKiss ? "Kiss+thru" : "Appliser+thru")
          : harTrykk && v.valg.thruCut ? "Print+kiss+thru" : v.valg.thruCut ? "Kiss+thru" : "Kiss";
        const felt = v.valg.kunThru && !regThru && !helfol ? ` felt ${ark.breddeMm}x${ark.arklengde}` : "";
        filer.push({
          slag: "produksjon",
          navn: `${grunnNavn} ${prosess} ${folie.kode}${felt} 100%.pdf`,
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
        regmarkSett: rolleNr === 0 && (!kunThru || printThru) ? ark.regY.length : 0,
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
