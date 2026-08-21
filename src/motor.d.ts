/**
 * Typene til produksjonsmotoren. Denne fila forteller bare hva motoren
 * heter og hva den tar inn og gir ut. Selve koden ligger i motor.js.
 */

export interface Linje {
  /** navnet som star pa skissen og i filnavnet */
  navn: string;
  /**
   * logoen som PDF, eller som .ai lagret PDF-kompatibelt.
   * Tekst ma vaere gjort om til outlines.
   */
  pdf: Uint8Array;
  /** onsket bredde pa ferdig element */
  breddeMm?: number;
  /** onsket hoyde pa ferdig element */
  hoydeMm?: number;
  /**
   * hvilket mal som styrer. Det andre folger av motivets egne proporsjoner.
   * Utelates den, styrer det maalet som er oppgitt.
   */
  styrende?: "bredde" | "hoyde";
  antall: number;
  /** folien hele motivet skjaeres i, nar det bare er en farge */
  folie?: Folie;
  /**
   * Fargeseparering. En folie per farge i filen, i samme rekkefolge som
   * analyserFil() ga dem. Settes en oppforing til null, smelter den fargen
   * sammen med den storste fargen som star igjen, sa logoen kan produseres
   * med faerre farger enn filen har.
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
  /** slik den star i filnavnet, f.eks. 751-010 */
  kode: string;
  /**
   * fargen slik den er lagret pa komponentvaren, som #rrggbb.
   * Den styrer bade hvordan motivet vises pa skissen og fyllet i
   * skjaerefila, sa operatoren ser hvilken folie arket gjelder.
   */
  hex?: string;
  /** rullens bredde. Utelates den, brukes 1200 mm. */
  breddeMm?: number;
  /**
   * overstyrer om skissen far gra bunn. Utelates den, avgjor motoren det
   * selv: lyse folier ville forsvunnet mot hvitt papir.
   */
  graaBunn?: boolean;
}

/**
 * Feltene som star oyverst pa skissen. Alle er valgfrie, og kommer fra
 * ordren nar modulen apnes derfra. Utelates korrekturdato, settes dagens
 * dato nar filene lages.
 */
export interface Felt {
  kundenavn?: string;
  kundenummer?: string;
  ordrenummer?: string;
  deresKontakt?: string;
  varKontakt?: string;
  korrekturdato?: string;
}

export interface Geo {
  foliebredde: number;
  bleed: number;
  gap: number;
  regmarkD: number;
  kissInset: number;
  regClear: number;
  regmarkKiss: number;
  boksKiss: number;
  regTarget: number;
  strek: number;
}

export interface Bestilling {
  jobb: string;
  /** standardfolie for linjer som ikke har sin egen */
  folie?: Folie;
  linjer: Linje[];
  felt?: Felt;
  /** overstyrer maal som foliebredde. La den vaere med mindre du vet hvorfor. */
  geo?: Partial<Geo>;
  /** kommer fra lastBilder(). Uten den lages ingen kundeskisse. */
  bilder?: { disclaimer: any; vannmerke: any };
  kundeValg?: {
    dpi?: number;
    styrke?: number;
    vinkel?: number;
    kolonner?: number;
    kvalitet?: number;
    skrift?: string;
  };
  /** bare til testing utenfor nettleser */
  lerret?: (b: number, h: number) => any;
}

export interface Analyse {
  navn: string;
  breddeMm: number;
  hoydeMm: number;
  antall: number;
  /** antall sammenhengende flater som skal lukes */
  flater: number;
  /** antall hull inni flatene */
  hull: number;
  omkretsMm: number;
  arealCm2: number;
  /** omkrets delt pa areal, et grovt maal pa hvor mye luking det blir */
  oa: number;
  tynnesteMm: number;
  status: "ok" | "tynn" | "kritisk";
  /** minste bredde motivet ma opp i for a kunne skjaeres */
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
  /** primaer, sekundaer, tertiaer ... Primaerfargen barer regmarks. */
  rolle: string;
  breddeMm: number;
  lengdeMm: number;
  kvadratmeter: number;
  elementer: number;
  roterte: number;
  regmarkSett: number;
  brukbarBreddeMm: number;
  strategi: string;
}

export interface JobbResultat {
  analyse: Analyse[];
  /** ett ark per folie. Linjer i ulike folier kan ikke ligge pa samme rull. */
  ark: ArkInfo[];
  filer: Fil[];
  advarsler: string[];
}

export interface FilFarge {
  hex: string;
  /** andel av motivets areal, 0 til 1 */
  andel: number;
}

export interface FilAnalyse {
  /** fargene i filen, storste flate forst */
  farger: FilFarge[];
  levendeTekst: boolean;
  /** hoyde delt pa bredde, sa skjemaet kan regne ut det andre malet */
  formatforhold: number;
}

/**
 * Leses ved opplasting, for a vite hvor mange materialfelt skjemaet skal
 * vise. Rask: ingen maling av tynneste detalj, ingen pakking.
 */
export function analyserFil(pdf: Uint8Array): Promise<FilAnalyse>;

/** Kjorer hele jobben. Alt skjer i nettleseren. */
export function kjorJobb(b: Bestilling): Promise<JobbResultat>;

/** Henter logoen og disclaimeren som skissen trenger. */
export function lastBilder(): Promise<{ disclaimer: any; vannmerke: any }>;

export const DISCLAIMER: string;
export const VANNMERKE: string;
export const STD_GEO: Geo;
export const MIN_DETALJ: number;
export const ADVAR_DETALJ: number;

/* ---------- bilskisse ---------- */

/** HTMLImageElement i nettleseren, Image fra @napi-rs/canvas i node. */
export type Bilde = any;
/** HTMLCanvasElement i nettleseren, Canvas fra @napi-rs/canvas i node. */
export type Lerret = any;
export type LerretFabrikk = (b: number, h: number) => Lerret;

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

/**
 * Leser en bilskisse: gir malestokk, visninger, hvert dekorelement som ren
 * PDF med ekte millimetermal, og bilskissen som jpeg til forsiden paa
 * kundeskissen.
 *
 * Elementene kan sendes rett videre som linjer til kjorJobb. Merk at
 * bilskisseflyten er den eneste som skal snu noe: settes elementene inn i
 * en jobb, maa `snuOpp: true` settes selv. Vanlige skiltjobber skal ikke
 * ha den.
 */
export function lesBilskisse(kilde: Uint8Array, v: BilValg): Promise<BilSkisseLest>;

/**
 * Foreslar folie per farge i ett element, mot en katalog.
 *
 * Hvitt nederst i bunken er skissens egen bakgrunn og foreslas som
 * "negativt": fargen skjaeres ikke i egen folie, den skjaeres negativt ut
 * av fargen under, og ligger den nederst faller den bort helt. Resten gaar
 * til naermeste folie i katalogen. Forslaget kan settes rett inn i
 * Linje.folier.
 */
export function foreslaFolier(farger: BilFarge[], katalog: Folie[]): (Folie | "negativt")[];

/**
 * Hvilken bundle som kjorer, pa formen "<kort-sha> <tidspunkt>",
 * f.eks. "8068736 2026-08-19T07:40Z". Settes ved bygg.
 * Er bundlen bygget utenom GitHub Action-en, staar plassholderen igjen
 * og USTEMPLET er true.
 */
export const VERSJON: string;
export const USTEMPLET: boolean;
