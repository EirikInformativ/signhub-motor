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
import { PDFDocument, PDFName } from "pdf-lib";
import { lesLett, tolk } from "./bilskisse.ts";
import type { TekstBoks } from "./bilskisse.ts";
import { finnDekor, BILFARGER } from "./dekorfinn.ts";
import { hentBaner, skrivPdf } from "./uttrekk.ts";
import { finnTekst, tekstTilKurver } from "./tekstkurver.ts";
import type { Bane } from "./uttrekk.ts";
import { hentGeometriPerFarge, areal, cmykTilRgb, tilHex } from "./pdfbaner.ts";
import * as pcModul from "polygon-clipping";
const pc: any = (pcModul as any).default ?? pcModul;
import { tegnBilSkisse } from "./skisse_bil.ts";
import { kuttVedBildeler, enderVedKant, skjoterLangs, KLIPP_LUFT_MM, KLIPP_MIN_MM, synligBoks, kuttVedKlipp, klippFlate as klippFlateBane, opphavAv, flate as flateKlipp, ringerAv, areal as arealKlipp, utvid as utvidKlipp } from "./klippkant.ts";
const flateAvSegs = (segs: any[]) => flateKlipp(ringerAv(segs));
/** en stripe slutter ved en kant paa bilen naar en av bilens linjer krysser den saa naer enden */
const KANT_ENDE_MM = 15;
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
  /**
   * satt naar elementet trolig er det samme merket som et annet, sett fra
   * en annen visning (for eksempel panseret i front- og toppvisning).
   * Elementet er ikke fjernet. Appen boer la brukeren ta det ut.
   */
  sammeSom?: string;
  /**
   * satt naar elementet har faatt et passmerke: en strimmel som viser hvor
   * nabo-elementet skal ligge. Den rives av etter montering.
   */
  passmerke?: { mot: string; hex: string; lengdeMm: number };
  /**
   * satt naar minst halvparten av elementet ligger paa en vindusrute
   * (gradientene i skissen). Glass trenger annen folie enn lakk (Eirik
   * 16.11.2026: hvit paa glass 3106, sort bunn paa glass 961, hvit paa
   * 961-bunn 010). Appen bruker dette i folieforslaget.
   */
  paaGlass?: boolean;
  /**
   * satt naar skissen bare viser én side og elementet er lagt til for den
   * andre siden (Eirik 17.11.2026, E-Partner 306005). Tekst og logo skal
   * staa riktig vei og telles i `antall`. Striper og dekor speilvendes og
   * blir et eget element med `speilet: true` (kilden i `kilde`). Er motoren
   * usikker, er `usikker` satt: appen boer markere elementet (gul ramme) og
   * la brukeren snu valget.
   */
  ensidig?: { speilet: boolean; usikker: boolean; kilde?: string; grunn: string };
  /**
   * Satt naar elementet er et innsatt bilde som skal printes (Eirik
   * 17.11.2026). ppi er i full stoerrelse paa bilen, ikke i skissens
   * malestokk. Bildet fra skissa er ofte bare en forhaandsvisning; appen
   * kan sende originalen i kjorJobb (linje.bilde), og da regnes ppi paa nytt.
   */
  bilde?: { ppi: number; px: [number, number]; kilde: "skisse" };
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
  /** samme merke sett fra en annen vinkel (panseret forfra): tatt ut av elementer, kan legges inn igjen */
  utelatt: BilElement[];
  /** bilskissen ferdig tegnet, klar som forside paa kundeskissen */
  forside: { jpeg: Uint8Array; bredde: number; hoyde: number };
  /**
   * Bare det et menneske maa gjoere noe med (Eirik 16.11.2026: «dette er
   * bare stoey for menneske. vi vil bare at det funker»): levende tekst,
   * samme merke to ganger, synlig dekor som ikke kom med, skisse som ikke
   * er til aa stole paa.
   */
  merknader: string[];
  /** hva motoren gjorde av seg selv (kutt, retting, deling, passmerke): til feilsoeking, ikke til skjermen */
  logg: string[];
  /**
   * levende tekst i visningene. Den er ikke med i skjaerefilene. element
   * er satt naar teksten staar ved et dekorelement.
   */
  levendeTekst: { tekst: string; vis: string; element: string | null }[];
}

export interface BilValg {
  jobb: string;
  bilder: { disclaimer: Bilde; vannmerke: Bilde };
  lerret: LerretFabrikk;
  /** bredden paa bilskissen i piksler. 1400 gir god lesbarhet paa A4. */
  bredde?: number;
}

/**
 * Fargen en bane faktisk faar i den skrevne element-PDF-en.
 *
 * skrivPdf runder til tre desimaler for den skriver `k`, og
 * hentGeometriPerFarge leser det tilbake gjennom cmykTilRgb. Rundingen
 * gjoeres derfor her ogsaa, saa hexen vi filtrerer paa er noeyaktig den
 * separeringen kommer til aa se.
 */
const r3 = (v: number) => Math.round(v * 1000) / 1000;
const baneHex = (f: number[]) =>
  tilHex(cmykTilRgb(r3(f[0] ?? 0), r3(f[1] ?? 0), r3(f[2] ?? 0), r3(f[3] ?? 0)));

/**
 * Hoerer banen til bakgrunnsplaten?
 *
 * En bane som bade fylles og strekes ligger i to lag, og skal bare bort
 * naar begge deler er platefargen. Ellers ville vi tatt med en strek som
 * hoerer til en annen farge.
 */
function horerTilPlaten(b: Bane, platehex: string): boolean {
  const fyllTreff = b.fyll && baneHex(b.farge) === platehex;
  const strekTreff = b.strek && baneHex(b.strekFarge ?? b.farge) === platehex;
  if (b.fyll && b.strek) return fyllTreff && strekTreff;
  return b.fyll ? fyllTreff : strekTreff;
}

export async function lesBilskisse(inn: Uint8Array, v: BilValg): Promise<BilSkisseLest> {
  let kilde = inn;
  let lett = await lesLett(kilde);
  let s = tolk(lett);
  /**
   * Staar det en malestokk paa arket, er den fasit. Maalingen er vakthund.
   * Reglene staar i velgMalestokk i bilskisse.ts.
   */
  const malestokk = s.malestokk;
  if (!malestokk) {
    throw new Error(
      s.malestokkTekst && s.malt
        ? `Malestokken i skissen er ikke til a stole pa: teksten sier ` +
          `1:${s.malestokkTekst}, malingen sier 1:${s.malt.toFixed(1)}. ` +
          "Kontroller arket."
        : "Fant ingen malestokk i skissen. Uten den kan ikke ekte mal regnes ut.");
  }
  let funn = finnDekor(lett, malestokk, { L: s.lengdeM, B: s.breddeM, H: s.hoydeM });
  /**
   * Levende tekst i visningene gjoeres om til kurver naar fonten er
   * innebygd (tekstkurver.ts). Utvalget er det samme som finnLevendeTekst
   * melder: synlig tekst inne i en visning, ikke i skissens egne farger.
   * Arkets egen tekst (overskrift, malestokk) staar igjen som tekst, saa
   * tolk finner malestokken som foer. Skissen leses saa paa nytt, og
   * teksten gaar gjennom finnDekor og resten som vanlige baner.
   */
  const levendeFoer = finnLevendeTekst(lett.levende, funn, malestokk);
  let tekstLogg: string | null = null;
  if (levendeFoer.length) {
    try {
      const vis = await finnTekst(kilde);
      // litt luft rundt visningen: lesLett anslaar tekstens ramme grovt, og et tegn
      // ved kanten skal ikke bli staaende som levende tekst fordi rammene spriker
      const velg = new Set(vis.filter((t) => t.kan && tekstIVisning(t, funn, 2 * MM)).map((t) => t.id));
      const r = velg.size ? await tekstTilKurver(kilde, velg) : null;
      if (r && r.gjort.length) {
        const lett2 = await lesLett(r.pdf);
        const s2 = tolk(lett2);
        if (s2.malestokk === malestokk) {
          kilde = r.pdf; lett = lett2; s = s2;
          funn = finnDekor(lett, malestokk, { L: s.lengdeM, B: s.breddeM, H: s.hoydeM });
          const igjen = finnLevendeTekst(lett.levende, funn, malestokk);
          const nokkel = (x: { tekst: string; vis: string }) => `${x.vis}|${x.tekst}`;
          const rest = new Map<string, number>();
          for (const x of igjen) rest.set(nokkel(x), (rest.get(nokkel(x)) ?? 0) + 1);
          const gjort = levendeFoer.filter((x) => {
            const n = rest.get(nokkel(x)) ?? 0;
            if (n > 0) { rest.set(nokkel(x), n - 1); return false; }
            return true;
          });
          if (gjort.length) tekstLogg = `${gjort.length} ${gjort.length === 1 ? "tekstlinje" : "tekstlinjer"} i visningene ` +
            `var levende tekst og er gjort om til kurver fra fonten som er innebygd i skissen: ` +
            gjort.slice(0, 8).map((x) => `«${x.tekst.slice(0, 30)}» (${x.vis})`).join(", ") +
            (gjort.length > 8 ? ` og ${gjort.length - 8} til` : "") + ".";
        } else {
          console.warn(`SignHub-motor: malestokken endret seg etter at teksten ble gjort om til kurver ` +
            `(1:${malestokk} mot 1:${s2.malestokk}). Teksten staar som levende tekst.`);
        }
      }
    } catch (e) {
      // en feil her skal aldri ut til brukeren: teksten staar som levende tekst og meldes
      console.warn("SignHub-motor: tekst til kurver feilet:", e);
    }
  }
  const merknader = [...s.merknader, ...funn.merknader];
  const logg: string[] = [];
  if (tekstLogg) logg.push(tekstLogg);
  const levendeTekst = finnLevendeTekst(lett.levende, funn, malestokk);
  for (const t of levendeTekst.filter((x) => x.element)) merknader.push(
    `${t.element}: teksten «${t.tekst}» er levende tekst og er IKKE med i skjaerefilene. ` +
    "Konverter teksten til kurver i skissen og les den inn paa nytt.");
  // annen tekst i visningene kan vaere dekor eller arkinformasjon: en samlet melding
  const loes = levendeTekst.filter((x) => !x.element);
  if (loes.length) merknader.push(
    `${loes.length} tekstlinjer i visningene er levende tekst og er ikke med, ` +
    `blant annet ${loes.slice(0, 3).map((x) => `«${x.tekst.slice(0, 30)}»`).join(", ")}. ` +
    "Er noe av dette dekor, maa det konverteres til kurver i skissen.");

  /**
   * Bilens farge i skissen: den fyllfargen som dekker mest. Paa begge
   * skissene vi har (proace2 og 309916 e-expert) er det hvitt, og klart.
   * Den trengs for aa avgjoere om en bakgrunnsplate er lakken.
   */
  const lakkHex = (() => {
    const m = new Map<string, number>();
    for (const b of lett.bokser) {
      if (!b.farge || b.farge.length !== 4) continue;
      const hx = baneHex(b.farge);
      m.set(hx, (m.get(hx) ?? 0) + (b.x1 - b.x0) * (b.y1 - b.y0));
    }
    return [...m].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  })();

  const { baner } = await hentBaner(kilde);
  // vindusrutene: gradientene CCVision fyller rutene med (klippet de fyller)
  const rutene: any[] = [];
  for (const b of baner) if (b.gradient) { try { const f = flateAvSegs(b.segs as any[]); if (f?.length) rutene.push(f); } catch { /* hopp over */ } }
  const andel = (b: any, o: any) => {
    const ox = Math.max(0, Math.min(b.boks.x1, o.x1) - Math.max(b.boks.x0, o.x0));
    const oy = Math.max(0, Math.min(b.boks.y1, o.y1) - Math.max(b.boks.y0, o.y0));
    return (ox * oy) / Math.max((b.boks.x1 - b.boks.x0) * (b.boks.y1 - b.boks.y0), 1e-9);
  };

  const elementer: BilElement[] = [];
  /** banene som faktisk ligger i hvert elements PDF, til passmerkene */
  const brukteBaner = new Map<BilElement, Bane[]>();
  /**
   * Hvert omraade deles i delene sine foer det blir elementer (Eirik
   * 16.11.2026, Kia PV5 310079): teksten «RØR - ELEKTRO - ENERGI» staar ved
   * A-en, den gronne trekanten over den lange stripen, og «åtg.no» over
   * stripen bak. Holdes de sammen, maa hele rammen skjaeres, og det er
   * nesten bare luft. De skal skjaeres hver for seg.
   *
   * Regelen: delene slaas bare sammen naar de ligger naer hverandre
   * (DEL_GLIPPE_MM) OG den felles rammen ikke er stort mer enn delene selv
   * (DEL_LUFT). Bokstavene i en tekst og delene av ÅTG gir felles ramme
   * 1,3 til 1,4 ganger delene; A-en med stripen gir 2,7. En logo holdes
   * sammen, mens tekst og striper som bare staar ved siden av, skilles.
   */
  const arbeid: { o: typeof funn.omraader[number]; valgte: Bane[] }[] = [];
  /** tekst skilt ut fra en flerfarget logo; bare disse faar passmerke over/under logoen */
  const utskiltTekst = new Set<Bane[]>();
  const utskiltNavn = new Set<string>();
  /** tekstlister skilt fra logoen for aa spare folie: ingen passmerke (Eirik 18.11.2026, Rydd Bergen) */
  const listeTekst = new Set<Bane[]>();
  const listeNavn = new Set<string>();
  const valgtPerOmraade: { o: typeof funn.omraader[number]; valgte: Bane[] }[] = [];
  for (const o of funn.omraader) {
    /**
     * Bilens egne streker og flater ligger ofte inne i rammen til en stor
     * dekor: paa Kia PV5 (310079) gaar stripene over doerhaandtak, skinne
     * og vindu. Bilen er tegnet i rene K-graatoner (CMY 0, K mellom 1 og
     * 99 %). Slike baner er bil og tas ikke med i elementet, med mindre de
     * ligger helt inne i en annen farge (da er de en del av logoen).
     */
    const bilGraa = (f?: number[]) => !!f && f.length === 4 &&
      Math.max(f[0], f[1], f[2]) < 0.01 && f[3] > 0.01 && f[3] < 0.99;
    const erBil = (b: Bane) => (b.fyll ? bilGraa(b.farge) : true) && (b.strek ? bilGraa(b.strekFarge ?? b.farge) : true);
    // banen maa svare til en av flatene finnDekor valgte (samme ramme)
    const T = 0.6;
    // lesLett ser bare det som synes innenfor klippet; sammenlign med det samme
    /**
     * Banen er den finnDekor valgte. lesLett og synligBoks klipper litt
     * ulikt (Oesterboe, Vito 304160: den ene halvdelen av den store Oe-en
     * bommet med 8 pt paa en kant og falt ut, halve logoen manglet).
     * Derfor overlapp, ikke hver kant for seg.
     */
    const likBoks = (b: Bane) => { const sb = synligBoks(b); return o.liste.some((x) => {
      if (Math.abs(x.x0 - sb.x0) < T && Math.abs(x.y0 - sb.y0) < T && Math.abs(x.x1 - sb.x1) < T && Math.abs(x.y1 - sb.y1) < T) return true;
      const iw = Math.min(x.x1, sb.x1) - Math.max(x.x0, sb.x0), ih = Math.min(x.y1, sb.y1) - Math.max(x.y0, sb.y0);
      if (iw <= 0 || ih <= 0) return false;
      const snitt = iw * ih, a = (x.x1 - x.x0) * (x.y1 - x.y0), c = (sb.x1 - sb.x0) * (sb.y1 - sb.y0);
      return snitt / (a + c - snitt) >= LIK_BOKS_OVERLAPP && (!x.farge || !b.farge || x.farge.length !== b.farge.length || x.farge.every((v, i) => Math.abs(v - (b.farge[i] ?? 0)) < 0.02));
    }); };
    // en graa flate finnDekor selv har valgt (graa rute bak en kuloer, LTS Maskin) er dekor
    const valgtGraa = (b: Bane) => o.liste.some((x) => !!x.farge && x.farge.length === 4 &&
      Math.max(x.farge[0], x.farge[1], x.farge[2]) < 0.01 && x.farge[3] > 0.01 && x.farge[3] < 0.99) && likBoks(b);
    const valgte = baner.filter((b) => !b.gradient && !b.bilde && andel({ ...b, boks: synligBoks(b) } as Bane, o) >= 0.9 && (!erBil(b) || valgtGraa(b)) && likBoks(b))
      /**
       * Bare striper kuttes ved klippet. Et logoikon som designeren har
       * klippet langs karosseriet skjaeres helt (Eirik 17.11.2026, Oesterboe:
       * «her hadde nok jeg bare kjørt hele logoikonet med alt med. lite å
       * tjene på å kutte de ned litt og det gir montøren mer fleksibilitet»).
       */
      .map((b) => {
        const w = b.boks.x1 - b.boks.x0, h = b.boks.y1 - b.boks.y0;
        const stripe = Math.max(w, h) >= STRIPE_FORHOLD_BIL * Math.max(1e-9, Math.min(w, h));
        /**
         * Et felt mye lengre enn rullen er bred kuttes ogsaa ved klippet
         * (Saethre ID.Buzz 17.11.2026: de oransje feltene er tegnet langt ut
         * forbi bilen og klippet langs karosseriet; uten kuttet ble det 12 m²
         * folie der 5,4 m² synes). Et logoikon (Oe-en paa Oesterboe, 1,1 m)
         * er kortere og skjaeres fortsatt helt.
         */
        const felt = (Math.max(w, h) / MM) * malestokk > FELT_KLIPP_MM;
        return stripe || felt ? kuttVedKlipp(b, (KLIPP_LUFT_MM / malestokk) * MM) : b;
      });
    if (valgte.length) valgtPerOmraade.push({ o, valgte });
  }
  /**
   * Dekor som gaar inn under bilens egne deler kuttes 50 mm forbi det som
   * synes (Eirik 16.11.2026, Kia PV5 310079). Reglene staar i klippkant.ts.
   */
  const alleDekor = new Set(valgtPerOmraade.flatMap((x) => x.valgte));
  const dekorOpphav = new Set([...alleDekor].map((b) => opphavAv.get(b) ?? b));
  const bilLinjer = baner.filter((b) => !b.bilde && !b.gradient && !alleDekor.has(b) && !dekorOpphav.has(b));
  const luft = (KLIPP_LUFT_MM / malestokk) * MM, min = (KLIPP_MIN_MM / malestokk) * MM;
  for (const x of valgtPerOmraade) {
    const r = kuttVedBildeler(x.valgte, baner, (b) => alleDekor.has(b), luft, min);
    if (r.fjernet > 0) logg.push(`${x.o.vis} ${x.o.navn}: dekoren gaar inn under bilens egne deler ` +
      `og er kuttet ${KLIPP_LUFT_MM} mm forbi det som synes. Sparer ` +
      `${(r.fjernet / MM / MM * malestokk * malestokk / 1e6).toFixed(2).replace(".", ",")} m² folie ` +
      `(${(r.fjernet / r.foer * 100).toFixed(0)} % av de kuttede delene). Alt som synes paa bilen er med` +
      (r.gjennomsyn ? ", bortsett fra smaa gjennomsyn mellom bildelene (for eksempel mellom hjulbue og dekk)." : "."));
    if (r.rettet) logg.push(`${x.o.vis} ${x.o.navn}: ${r.rettet} ${r.rettet === 1 ? "stripe" : "striper"} med ender ` +
      "under bilens deler er rettet ut til rektangel. Endene kan forlenges paa arket.");
    if (r.knotter) merknader.push(`${x.o.vis} ${x.o.navn}: smaa synlige knotter i kanten mot bildelene ` +
      `(under ${KLIPP_MIN_MM} mm brede, for eksempel en flekk ved speilfoten) er ikke tatt med, saa kuttlinjen blir rett. ` +
      "Sjekk skissen hvis en slik bit er ment aa synes.");
    if (r.forlenget) logg.push(`${x.o.vis} ${x.o.navn}: dekoren gikk mindre enn ${KLIPP_MIN_MM} mm inn ` +
      `under bilens deler og er forlenget til ${KLIPP_LUFT_MM} mm (${r.forlenget} ${r.forlenget === 1 ? "del" : "deler"}), ` +
      "saa montoeren har noe aa skjaere til etter. Det som er lagt til, ligger under bildelen og synes ikke.");
    if (r.kortForbi.length) merknader.push(`${x.o.vis} ${x.o.navn}: dekoren gaar mindre enn ` +
      `${KLIPP_MIN_MM} mm inn under bilens deler (${r.kortForbi.length} ${r.kortForbi.length === 1 ? "del" : "deler"}). ` +
      "Montoeren trenger noe aa skjaere til etter. Forleng dekoren i skissen.");
    x.valgte = r.baner;
    if (r.helSkjult.length) logg.push(`${x.o.vis} ${x.o.navn}: ${r.helSkjult.length} ${r.helSkjult.length === 1 ? "flate" : "flater"} ` +
      "ligger helt under bilens egne deler og synes ikke paa bilen. De er ikke dekor og skjaeres ikke.");
    // striper som slutter ved en kant paa bilen kan ogsaa forlenges paa arket
    x.valgte = x.valgte.map((b) => {
      if (b.skjultEnde) return b;
      const k = enderVedKant(b, baner, (o) => alleDekor.has(o), (KANT_ENDE_MM / malestokk) * MM);
      return k ? { ...b, skjultEnde: k } : b;
    });
  }
  for (const { o, valgte } of valgtPerOmraade) {
    if (!valgte.length) continue;
    let deler = samleDeler(valgte, (DEL_FIN_MM / malestokk) * MM, (DEL_GLIPPE_MM / malestokk) * MM);
    /**
     * En del som ikke faar plass paa rullen paa noen leddet, deles finere
     * (Vito bak: den roede flaten naar nesten bort til «CENTER», og logoen,
     * flaten og tekstene ble ett element paa 1,6 m). Bare delene som staar
     * inntil hverandre holdes sammen.
     */
    const forStor = (d: Bane[]) => (minsteBredde(d) / MM) * malestokk > MAKS_DEL_MM;
    // samme regler, men aldri sammen til noe som er for stort
    deler = deler.flatMap((d) => forStor(d)
      ? samleDeler(d, (3 / malestokk) * MM, (DEL_GLIPPE_MM / malestokk) * MM, (x) => !forStor(x), (a, b) => {
          // en stor flate (den roede bak) tar ikke med seg bokstaver og tall
          // som bare staar ved siden av; to store flater kan hoere sammen
          const stor = (x: Bane[]) => (Math.min(
            Math.max(...x.map((q) => q.boks.x1)) - Math.min(...x.map((q) => q.boks.x0)),
            Math.max(...x.map((q) => q.boks.y1)) - Math.min(...x.map((q) => q.boks.y0))) / MM) * malestokk > STOR_FLATE_MM &&
            x.reduce((n, q) => n + (q.segs as any[]).filter((y) => y.t === "m").length, 0) <= 4;
          return stor(a) === stor(b);
        }) : [d]);
    /**
     * Tekst i én farge som staar utenfor en flerfarget logo, men i en farge
     * logoen ogsaa har inni seg, skilles ut (Eirik 16.11.2026, LTS Maskin
     * paa E-Partner 306005: logoen med den blaa bunnen og de hvite
     * bokstavene printes, den hvite teksten under skjaeres i 010). Ellers kan
     * ikke appen gi teksten en annen folie enn logoen. De to faar passmerke.
     */
    deler = deler.flatMap((d) => {
      const hex = (b: Bane) => baneHex(b.farge);
      for (const c of new Set(d.filter((b) => b.fyll).map(hex))) {
        const kjerne = d.filter((b) => hex(b) !== c);
        // kjernen er en flerfarget logo (blaa og roed paa LTS), ikke én farge (ÅTG-streken)
        if (new Set(kjerne.map(hex)).size < 2) continue;
        const K = { x0: Math.min(...kjerne.map((b) => b.boks.x0)), y0: Math.min(...kjerne.map((b) => b.boks.y0)),
          x1: Math.max(...kjerne.map((b) => b.boks.x1)), y1: Math.max(...kjerne.map((b) => b.boks.y1)) };
        const tol = 0.1 * Math.min(K.x1 - K.x0, K.y1 - K.y0);
        const inni = (b: Bane) => b.boks.x0 >= K.x0 - tol && b.boks.x1 <= K.x1 + tol && b.boks.y0 >= K.y0 - tol && b.boks.y1 <= K.y1 + tol;
        const ute = (b: Bane) => b.boks.x1 < K.x0 || b.boks.x0 > K.x1 || b.boks.y1 < K.y0 || b.boks.y0 > K.y1;
        const egne = d.filter((b) => hex(b) === c);
        const utenfor = egne.filter(ute);
        if (!utenfor.length || !egne.some(inni) || utenfor.length === egne.length) continue;
        if (d.some((b) => hex(b) === c && !inni(b) && !ute(b))) continue;   // noe ligger over kanten: én logo
        // tekst over og tekst under logoen er to tekster (kontaktinfo over, slagord under)
        /*
         * Teksten samles foerst i klynger (bokstaver naer hverandre), og
         * siden avgjoeres for hele klyngen ut fra midtpunktet. «Din» paa
         * toppen av LTS stakk forbi enden av logoen og ble skilt fra resten
         * av slagordet da hver bane fikk sin egen side (Eirik 17.11.2026).
         */
        const naer = 2 * tol;
        const avst = (a: Bane["boks"], b: Bane["boks"]) => Math.hypot(
          Math.max(0, a.x0 - b.x1, b.x0 - a.x1), Math.max(0, a.y0 - b.y1, b.y0 - a.y1));
        const klynge = utenfor.map((_, i) => i);
        const rot = (i: number): number => klynge[i] === i ? i : (klynge[i] = rot(klynge[i]));
        for (let i = 0; i < utenfor.length; i++) for (let j = i + 1; j < utenfor.length; j++)
          if (avst(utenfor[i].boks, utenfor[j].boks) < naer) klynge[rot(i)] = rot(j);
        const kl = new Map<number, Bane[]>();
        utenfor.forEach((b, i) => { const r = rot(i); if (!kl.has(r)) kl.set(r, []); kl.get(r)!.push(b); });
        const side = (bs: Bane[]) => {
          const cx = (Math.min(...bs.map((b) => b.boks.x0)) + Math.max(...bs.map((b) => b.boks.x1))) / 2;
          const cy = (Math.min(...bs.map((b) => b.boks.y0)) + Math.max(...bs.map((b) => b.boks.y1))) / 2;
          const dx = cx < K.x0 ? K.x0 - cx : cx > K.x1 ? cx - K.x1 : 0;
          const dy = cy < K.y0 ? K.y0 - cy : cy > K.y1 ? cy - K.y1 : 0;
          return dy >= dx ? (cy > K.y1 ? "over" : "under") : (cx < K.x0 ? "venstre" : "hoyre");
        };
        const grupper = new Map<string, Bane[]>();
        for (const bs of kl.values()) { const k = side(bs); if (!grupper.has(k)) grupper.set(k, []); grupper.get(k)!.push(...bs); }
        for (const g of grupper.values()) utskiltTekst.add(g);
        return [d.filter((b) => !utenfor.includes(b)), ...grupper.values()];
      }
      return [d];
    });
    /**
     * En tekstblokk i én farge rett over, under eller ved siden av en
     * flerfarget logo, i en farge logoen ogsaa har, skilles ut naar det
     * sparer folie (Eirik 18.11.2026, Rydd Bergen bak: «smørbrødlisten» under
     * logoen. I register maa den roede folien vaere like stor som hele
     * logoen med lista; skilt ut kan lista gaa paa det sorte oppsettet).
     * Kravet er et rent mellomrom paa tvers (ingen del krysser det), og at
     * logoens ramme blir minst DEL_SPAR mindre. Lista faar passmerke mot
     * logoen som annen utskilt tekst.
     */
    deler = deler.flatMap((d) => {
      const fylt = d.filter((b) => b.fyll);
      const hexer = new Set(fylt.map((b) => baneHex(b.farge)));
      if (hexer.size < 2) return [d];
      const ramme = (bs: Bane[]) => ({ x0: Math.min(...bs.map((b) => b.boks.x0)), y0: Math.min(...bs.map((b) => b.boks.y0)),
        x1: Math.max(...bs.map((b) => b.boks.x1)), y1: Math.max(...bs.map((b) => b.boks.y1)) });
      const ar = (r: ReturnType<typeof ramme>) => (r.x1 - r.x0) * (r.y1 - r.y0);
      const hel = ar(ramme(d));
      const minGlipe = (MIN_BAND_MM / malestokk) * MM;
      let best: { logo: Bane[]; tekst: Bane[]; a: number } | null = null;
      for (const akse of ["y", "x"] as const) {
        const lo = (b: Bane) => akse === "y" ? b.boks.y0 : b.boks.x0, hi = (b: Bane) => akse === "y" ? b.boks.y1 : b.boks.x1;
        const sortert = d.slice().sort((a, b) => lo(a) - lo(b));
        let maks = -Infinity;
        for (let k = 0; k < sortert.length - 1; k++) {
          maks = Math.max(maks, hi(sortert[k]));
          const glipe = lo(sortert[k + 1]) - maks;
          if (glipe < minGlipe) continue;
          const A = sortert.slice(0, k + 1), B = sortert.slice(k + 1);
          for (const [logo, tekst] of [[A, B], [B, A]] as const) {
            const tf = new Set(tekst.filter((b) => b.fyll).map((b) => baneHex(b.farge)));
            const lf = new Set(logo.filter((b) => b.fyll).map((b) => baneHex(b.farge)));
            if (tf.size !== 1 || lf.size < 2 || !lf.has([...tf][0])) continue;
            const flater = tekst.reduce((n, b) => n + (b.segs as any[]).filter((x) => x.t === "m").length, 0);
            if (flater < TEKST_FLATER) continue;
            // et ekte mellomrom, ikke luften mellom to bokstavkolonner i et ordmerke
            const hs = tekst.filter((b) => b.fyll).map((b) => b.boks.y1 - b.boks.y0).sort((p, q) => p - q);
            if (glipe < BAND_MOT_TEGN * hs[Math.floor(hs.length / 2)]) continue;
            const a = ar(ramme(logo));
            if (a > (1 - DEL_SPAR) * hel) continue;
            // en liste i smaa bokstaver, ikke et ord som er en del av merket
            // (PROFF ved XL-boksen paa panseret paa 309916 staar i register)
            const lr = ramme(logo);
            const tegn = tekst.filter((b) => b.fyll).map((b) => Math.min(b.boks.x1 - b.boks.x0, b.boks.y1 - b.boks.y0)).sort((p, q) => p - q);
            if (tegn[Math.floor(tegn.length / 2)] > BAND_TEGN_LOGO * Math.min(lr.x1 - lr.x0, lr.y1 - lr.y0)) continue;
            if (!best || a < best.a) best = { logo: [...logo], tekst: [...tekst], a };
          }
        }
      }
      if (!best) return [d];
      utskiltTekst.add(best.tekst);
      listeTekst.add(best.tekst);
      logg.push(`${o.vis} ${o.navn}: teksten i én farge ved logoen skilles ut og skjaeres for seg, ` +
        `logoens ramme blir ${Math.round((1 - best.a / hel) * 100)} % mindre.`);
      return [best.logo, best.tekst];
    });
    /**
     * Deler med en av bilens linjer i mellomrommet over hele bredden
     * skilles (Eirik 18.11.2026, Saethre 305007: profilen i karosseriet
     * mellom logoen og «www.skiferflis.no» er tredimensjonal, og folien kan
     * ikke legges i ett stykke over den). Kravet er et rent mellomrom paa
     * minst MIN_BAND_MM der bilens linjer dekker minst PROFIL_DEKK av
     * bredden.
     */
    deler = deler.flatMap((d) => profilDel(d, (MIN_BAND_MM / malestokk) * MM, bilLinjer, o, logg));
    if (deler.length === 1) { arbeid.push({ o, valgte }); continue; }
    deler.forEach((d, k) => {
      arbeid.push({ o: { ...o, navn: `${o.navn} del ${k + 1}` }, valgte: d });
      if (utskiltTekst.has(d)) utskiltNavn.add(`${o.vis} ${o.navn} del ${k + 1}`);
      if (listeTekst.has(d)) listeNavn.add(`${o.vis} ${o.navn} del ${k + 1}`);
    });
    logg.push(`${o.vis} ${o.navn}: delt i ${deler.length} deler som skjaeres hver for seg ` +
      "(tekst og striper som bare staar ved siden av hverandre).");
  }
  /**
   * Sperret tekst gaar paa tvers av omraadene finnDekor fant (Rydd Bergen:
   * «RYDDING OG BOSSKJØRING» kom i tre omraader). Delene i samme visning
   * kjedes derfor ogsaa paa tvers, med samme regel som inne i et omraade.
   */
  {
    const perVis = new Map<string, number[]>();
    arbeid.forEach((x, i) => { if (!perVis.has(x.o.vis)) perVis.set(x.o.vis, []); perVis.get(x.o.vis)!.push(i); });
    const fjern = new Set<number>();
    const nye: typeof arbeid = [];
    for (const ix of perVis.values()) {
      if (ix.length < 2) continue;
      const grupper = ix.map((i) => arbeid[i].valgte);
      const samlet = tekstlinjer(grupper, malestokk / MM);
      for (const gg of samlet) {
        const med = ix.filter((i) => arbeid[i].valgte.every((b) => gg.includes(b)));
        if (med.length < 2) continue;
        for (const i of med) fjern.add(i);
        const f = arbeid[med[0]];
        nye.push({ o: { ...f.o, navn: med.map((i) => arbeid[i].o.navn).join(" + ") }, valgte: gg });
        logg.push(`${f.o.vis}: ${med.length} deler (${med.map((i) => arbeid[i].o.navn).join(", ")}) er én sperret tekstlinje og leveres samlet.`);
      }
    }
    if (fjern.size) {
      const rest = arbeid.filter((_, i) => !fjern.has(i));
      arbeid.length = 0;
      arbeid.push(...rest, ...nye);
    }
  }
  for (const { o, valgte: raa } of arbeid) {
    let rett = rettOpp(raa);
    /**
     * Faar elementet ikke plass paa tvers av rullen med vanlig retting, leses
     * grunnlinjen ogsaa ved stoerre helning (Vito: logoen er skraadd 20°,
     * og staar den slik, er den 1,2 m hoey).
     */
    const minside = (bs: Bane[]) => {
      const w = Math.max(...bs.map((b) => b.boks.x1)) - Math.min(...bs.map((b) => b.boks.x0));
      const h = Math.max(...bs.map((b) => b.boks.y1)) - Math.min(...bs.map((b) => b.boks.y0));
      return (Math.min(w, h) / MM) * malestokk;
    };
    {
      const areal = (bs: Bane[]) => (Math.max(...bs.map((b) => b.boks.x1)) - Math.min(...bs.map((b) => b.boks.x0))) *
        (Math.max(...bs.map((b) => b.boks.y1)) - Math.min(...bs.map((b) => b.boks.y0)));
      const stor = rettOpp(raa, STOR_GRAD);
      // stor helning bare naar elementet ellers ikke faar plass, eller rammen blir mye mindre
      if (stor.vinkel && (minside(rett.baner) > MAKS_DEL_MM ? minside(stor.baner) < minside(rett.baner)
        : areal(stor.baner) < STOR_GEVINST * areal(rett.baner))) rett = stor;
      /**
       * Faar elementet fortsatt ikke plass paa tvers av rullen, proeves
       * enhver helning (Saethre ID.Buzz 17.11.2026: feltet bak staar paa
       * skraa, ca. 45°, og ga en ramme paa 2 033 mm; langs sin egen kant
       * er det ca. 600 mm). Ellers stoppet hele jobben med en feil.
       */
      if (minside(rett.baner) > MAKS_DEL_MM) {
        // vinkelen som gir smalest ramme (grunnlinjen finnes ikke alltid)
        const pk: [number, number][] = [];
        for (const b of raa) for (const sg of b.segs as any[]) { if (sg.p) pk.push(sg.p); if (sg.c) pk.push(sg.a, sg.b, sg.c); }
        let bestG = 0, bestB = Infinity;
        for (let g = -89; g <= 90; g += 0.5) {
          const r = (g * Math.PI) / 180, c = Math.cos(r), sn = Math.sin(r);
          let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
          for (const [x, y] of pk) { const X = c * x - sn * y, Y = sn * x + c * y;
            if (X < x0) x0 = X; if (X > x1) x1 = X; if (Y < y0) y0 = Y; if (Y > y1) y1 = Y; }
          const m = Math.min(x1 - x0, y1 - y0);
          if (m < bestB - 1e-9) { bestB = m; bestG = g; }
        }
        const alle = rettOpp(raa, 89, bestG);
        if (alle.vinkel && minside(alle.baner) < minside(rett.baner)) rett = alle;
      }
    }
    const valgte = rett.baner;
    if (rett.vinkel) logg.push(`${o.vis} ${o.navn}: rettet opp ${Math.abs(rett.vinkel).toFixed(1).replace(".", ",")}° i ` +
      `produksjonsfila (sparer ${rett.spartProsent.toFixed(0)} % ramme). Monteres med samme helning som paa skissen.`);
    // ogsaa her skal en feil si hvilket element den gjelder, ikke bare hvilken farge
    const lesTrygt = async (bytes: Uint8Array) => {
      try {
        return await hentGeometriPerFarge(bytes, 1.0);
      } catch (e: any) {
        throw new Error(`${o.vis} ${o.navn}: ${String(e?.message ?? e ?? "ukjent feil")}`);
      }
    };
    /**
     * En stripe med ender under bilen (rettet ut av kuttVedBildeler) faar
     * vite i PDF-en hvilke ender som kan forlenges, i elementets retning.
     * kjorJobb strekker dem ut i dodrommet paa et Appliser+thru-ark.
     */
    const forleng: string[] = [];
    if (valgte.length === 1 && valgte[0].skjultEnde) {
      const se = valgte[0].skjultEnde;
      const liggende = Math.abs(se.ux) >= Math.abs(se.uy);
      if (se.lav) forleng.push(liggende ? "venstre" : "bunn");
      if (se.hoy) forleng.push(liggende ? "hoyre" : "topp");
    }
    // bilens naturlige skjoeter langs en stripe: der skal den skjoetes (Vito)
    const fylte = raa.filter((b) => b.fyll);
    /**
     * Et felt i én farge som er lengre enn rullen er bred, deles ogsaa i
     * bilens skjoeter (Eirik 17.11.2026, Saethre ID.Buzz: det oransje feltet
     * over begge doerene ble skaaret i stykker per doer og lagt tett).
     */
    const storste = fylte.slice().sort((a, b) =>
      (b.boks.x1 - b.boks.x0) * (b.boks.y1 - b.boks.y0) - (a.boks.x1 - a.boks.x0) * (a.boks.y1 - a.boks.y0))[0];
    const enFarge = new Set(fylte.map((b) => baneHex(b.farge))).size === 1;
    const erFeltEl = enFarge && !!storste && (Math.max(storste.boks.x1 - storste.boks.x0, storste.boks.y1 - storste.boks.y0) / MM) * malestokk > MAKS_DEL_MM;
    const skjot = fylte.length >= 1 && (fylte.length <= 2 || erFeltEl) ? skjoterLangs(storste,
      baner, (x) => alleDekor.has(x), (SKJOT_TOL_MM / malestokk) * MM, (SKJOT_KANT_MM / malestokk) * MM, erFeltEl) : [];
    let pdf = await skrivPdf(valgte, undefined, forleng, skjot);
    let brukte = valgte;
    let per = await lesTrygt(pdf);
    let tegnetB = (per.bbox[2] - per.bbox[0]) / MM;
    let tegnetH = (per.bbox[3] - per.bbox[1]) / MM;
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
    let bakgrunn: BilFarge | undefined;
    const plateform = erBakgrunnsplate(per.lag.map((l) => l.flate), per.bbox);
    const bunnhex = per.lag[per.lag.length - 1]?.hex;
    /**
     * Formen alene er ikke nok. Paa 309916 e-expert har XL-logoen en svart
     * firkant innenfor gullrammen. Den fyller rammen og ser ut som en
     * plate, men den er dekor: bilen er hvit. Den ble tatt ut, og bare gull
     * ville blitt skaaret. Motoren fjerner aldri noe fra en logo, saa platen
     * tas bare ut naar den ogsaa har bilens farge. Er vi i tvil, blir den
     * staaende og skjaeres.
     */
    if (plateform && bunnhex !== lakkHex) logg.push(
      `${o.vis} ${o.navn}: nederste farge ${bunnhex} fyller motivet som en plate, ` +
      `men bilen er ${lakkHex ?? "ukjent farge"}. Den er derfor en del av logoen og skjaeres.`);
    if (plateform && lakkHex && bunnhex === lakkHex) {
      const plate = per.lag[per.lag.length - 1];
      const platehex = plate.hex;
      /**
       * Platen tas ut av selve element-PDF-en, ikke bare av fargelista.
       *
       * Foerste utgave meldte to farger og leverte en PDF med tre lag.
       * Appen bygde da folier med to oppfoeringer, kjorJobb leste fila paa
       * nytt og fant tre, og laget uten instruks ble forsoekt skaaret. Det
       * er nettopp den skjoere plategeometrien som ikke lar seg kutte, og
       * feilen kom ut paa feil farge fordi lagene talte i utakt.
       *
       * Det som meldes og det som utleveres maa vaere det samme. Naar
       * platen ikke finnes i fila, kan ingen som kaller motoren gjoere
       * dette feil.
       */
      const igjen = valgte.filter((b) => !horerTilPlaten(b, platehex));
      if (igjen.length && igjen.length < valgte.length) {
        pdf = await skrivPdf(igjen, undefined, forleng, skjot);
        brukte = igjen;
        // alt som meldes utledes na av den fila som faktisk leveres
        per = await lesTrygt(pdf);
        tegnetB = (per.bbox[2] - per.bbox[0]) / MM;
        tegnetH = (per.bbox[3] - per.bbox[1]) / MM;
      }
      if (per.lag.some((l) => l.hex === platehex)) {
        // filteret traff ikke: da meldes platen som en farge, slik at det
        // som meldes fortsatt er det som ligger i fila
        merknader.push(
          `${o.vis} ${o.navn}: bakgrunnsplaten ${platehex} lot seg ikke ` +
          "skille ut av filen, og staar derfor igjen som en vanlig farge. " +
          "Settes den ikke til negativt, skjaeres den som folie.");
      } else {
        bakgrunn = { hex: platehex, andel: plate.andel };
        logg.push(
          `${o.vis} ${o.navn}: bakgrunnsplaten ${platehex} ` +
          `(${(plate.andel * 100).toFixed(1)} % av motivet) er tatt ut, ` +
          "bade av fargelista og av filen. Den er ikke dekor, den er " +
          "mellomrommet, og skjaeres ikke.");
      }
    }

    // andel av elementets ramme som ligger paa en vindusrute
    let glassAndel = 0;
    try {
      const r = { x0: Math.min(...brukte.map((b) => b.boks.x0)), y0: Math.min(...brukte.map((b) => b.boks.y0)),
        x1: Math.max(...brukte.map((b) => b.boks.x1)), y1: Math.max(...brukte.map((b) => b.boks.y1)) };
      const rekt = [[[r.x0, r.y0], [r.x1, r.y0], [r.x1, r.y1], [r.x0, r.y1], [r.x0, r.y0]]];
      const A = (r.x1 - r.x0) * (r.y1 - r.y0);
      for (const g of rutene) glassAndel += arealKlipp(pc.intersection([rekt], g)) / Math.max(A, 1e-9);
    } catch { /* uten ruter */ }
    const nytt: BilElement = {
      id: nokkel, vis: o.vis, navn: `${o.vis} ${o.navn}`, pdf,
      ...(glassAndel >= 0.5 ? { paaGlass: true } : {}),
      breddeMm: Math.round(tegnetB * malestokk),
      hoydeMm: Math.round(tegnetH * malestokk),
      antall: 1,
      farger: per.lag.map((l) => ({ hex: l.hex, andel: l.andel })),
      ...(bakgrunn ? { bakgrunn } : {}),
    };
    if (!nytt.farger.length || !isFinite(nytt.breddeMm)) continue;   // ingenting synlig igjen
    elementer.push(nytt);
    brukteBaner.set(nytt, brukte);
  }
  if (!elementer.length) merknader.push("Ingen dekor a produsere i denne skissen.");


  /**
   * Samme merke sett fra to visninger. Paa 309916 e-expert staar XL PROFF
   * paa panseret baade i frontvisningen (978 x 55, sett skraatt ovenfra og
   * derfor sammentrykt) og i toppvisningen (227 x 978). Det er ett merke.
   * Kjennetegn: samme farger i samme forhold, samme lengste side, men den
   * andre siden er kortere fordi flaten heller bort fra oss. To like merker
   * paa to steder har begge sidene like og telles allerede som antall.
   *
   * Det minste merkes som samme som det stoerste og tas ut av jobben under.
   *
   * Bare mellom visninger av ulik type (ende, side, topp). To sidevisninger
   * ser bilen fra samme vinkel, saa ingenting er sammentrykt mellom dem.
   * Rydd Bergen: «R Y D D I N G  O G ...» er sperret saa hver bokstav blir
   * et eget element. Bokstavene har samme hoeyde og farge, og en smal I
   * paa den ene siden ble tatt for en sammentrykt O paa den andre. Fire
   * bokstaver forsvant ut av jobben (17.11.2026, da teksten ble kurver).
   */
  const visType = (v: string) => v.split(" ")[0];
  for (const a of elementer) for (const b of elementer) {
    if (a === b || visType(a.vis) === visType(b.vis) || a.sammeSom || b.sammeSom) continue;
    if (a.farger.length !== b.farger.length) continue;
    const likFarge = a.farger.every((f) => {
      const g = b.farger.find((x) => x.hex === f.hex);
      return g && Math.abs(g.andel - f.andel) < 0.015;
    });
    const la = Math.max(a.breddeMm, a.hoydeMm), lb = Math.max(b.breddeMm, b.hoydeMm);
    const ka = Math.min(a.breddeMm, a.hoydeMm), kb = Math.min(b.breddeMm, b.hoydeMm);
    if (!likFarge || Math.abs(la - lb) / Math.max(la, lb) > 0.02 || ka >= kb * 0.8) continue;
    a.sammeSom = b.navn;
  }

  /**
   * Panseret sett forfra der designeren har satt logoen litt annerledes
   * sammen i toppvisningen (Oesterboe, Vito 304160: Oe over teksten forfra,
   * ved siden av teksten ovenfra). Da stemmer ikke maalene, men det er
   * fortsatt samme merke. Kjennetegn: i en endevisning, midt paa bilen, i
   * samme farger som et merke i toppvisningen som ligger i en ende av
   * bilen, like bredt paa tvers (0,7 til 1,3) og sammentrykt i hoeyden.
   * Smaa biter av samme merke (en bokstav som ble skilt ut) foelger med.
   */
  const rammeAv = (e: BilElement) => {
    const bs = brukteBaner.get(e) ?? [];
    return bs.length ? { x0: Math.min(...bs.map((b) => b.boks.x0)), y0: Math.min(...bs.map((b) => b.boks.y0)),
      x1: Math.max(...bs.map((b) => b.boks.x1)), y1: Math.max(...bs.map((b) => b.boks.y1)) } : null;
  };
  const tilMm = (pt: number) => (pt / MM) * malestokk;
  const visAv = (navn: string) => funn.visninger.find((x) => x.navn === navn);
  for (const t of elementer) {
    const vt = visAv(t.vis), rt = rammeAv(t);
    if (!t.vis.startsWith("topp") || !vt || !rt || t.sammeSom) continue;
    const cxT = (rt.x0 + rt.x1) / 2, lengde = vt.x1 - vt.x0;
    if (Math.min(cxT - vt.x0, vt.x1 - cxT) > 0.3 * lengde) continue;
    const tvers = tilMm(rt.y1 - rt.y0), langs = tilMm(rt.x1 - rt.x0);
    const hexT = new Set(t.farger.map((f) => f.hex));
    for (const ve of funn.visninger.filter((x) => x.navn.startsWith("ende"))) {
      const kand = elementer.filter((e) => {
        const r = rammeAv(e);
        if (e.vis !== ve.navn || e.sammeSom || !r || !e.farger.every((f) => hexT.has(f.hex))) return false;
        const cx = (r.x0 + r.x1) / 2, vc = (ve.x0 + ve.x1) / 2;
        return Math.abs(cx - vc) < 0.15 * (ve.x1 - ve.x0);
      });
      if (!kand.length) continue;
      const rr = kand.map(rammeAv) as NonNullable<ReturnType<typeof rammeAv>>[];
      const b = tilMm(Math.max(...rr.map((r) => r.x1)) - Math.min(...rr.map((r) => r.x0)));
      const h = tilMm(Math.max(...rr.map((r) => r.y1)) - Math.min(...rr.map((r) => r.y0)));
      if (b < 0.7 * tvers || b > 1.3 * tvers || h > 0.8 * langs) continue;
      for (const e of kand) e.sammeSom = t.navn;
    }
  }

  /**
   * Det sammentrykte merket tas ut av jobben (Eirik 17.11.2026: «den
   * skvisede versjonen av panserlogoen (sett forfra) er med i
   * skjæreoppsettet. problematisk»). Det ligger i `utelatt`, saa appen kan
   * legge det inn igjen, og meldes.
   */
  const utelatt = elementer.filter((e) => e.sammeSom);
  for (const a of utelatt) {
    elementer.splice(elementer.indexOf(a), 1);
    logg.push(`${a.navn} (${a.breddeMm} x ${a.hoydeMm} mm) er samme merke som ${a.sammeSom}, ` +
      "sett fra en annen vinkel, og tas ikke med i jobben.");
  }

  /**
   * Etter at samme merke sett fra to vinkler er tatt ut: det
   * sammentrykte panseret forfra skal ut, ikke rettes.
   *
   * En logo har laaste proporsjoner (Eirik 18.11.2026, Rydd Bergen: logoen
   * fremst paa taket er strukket i hoeyden for aa se riktig ut paa det
   * skraa taket, «men faktum er at en logo har låste proposjoner». Bredden
   * er master). Finnes samme logo andre steder paa bilen, kjennes den igjen
   * paa delene (bokstaver og flater i samme farge og samme innbyrdes
   * plassering) med ulik skalering paa langs og tvers. Er de andre
   * forekomstene enige seg imellom, og denne er den som skiller seg ut,
   * skaleres hoeyden til proporsjonene de andre har.
   */
  await laasProporsjoner(elementer, brukteBaner, logg);
  /*
   * En liste skilt fra logoen faar ikke passmerke mot logoen: stubbene
   * gjoer logoens ramme stoerre og koster mer folie enn passmerket er verdt
   * (Eirik 18.11.2026, Rydd Bergen: «fjerne»).
   */
  await leggTekstPassmerker(elementer, brukteBaner, malestokk, logg, new Set([...utskiltNavn].filter((n) => !listeNavn.has(n))));
  await leggPassmerker(elementer, brukteBaner, malestokk, logg, utskiltNavn);
  await dupliserSide(funn.visninger.map((x) => x.navn), elementer, brukteBaner, merknader, logg);

  /**
   * Innsatte bilder (foto) blir egne print-elementer (Eirik 17.11.2026:
   * «print er jo med», Saethre Sten 305007 og Oesterboe). Formen er
   * klippebanen designeren har lagt paa bildet (vindusform,
   * gravsteinskanten); den blir thru-cut. Bildet ligger i element-PDF-en i
   * riktig mal og utsnitt, og kjorJobb printer det utfallende.
   */
  {
    let n = 0;
    for (const b of baner) {
      if (!b.bilde) continue;
      const vis = funn.visninger.find((x) => {
        const sb = synligBoks(b);
        const iw = Math.min(sb.x1, x.x1) - Math.max(sb.x0, x.x0), ih = Math.min(sb.y1, x.y1) - Math.max(sb.y0, x.y0);
        return iw > 0 && ih > 0 && iw * ih >= 0.5 * (sb.x1 - sb.x0) * (sb.y1 - sb.y0);
      });
      if (!vis) continue;
      const rute = flateKlipp(ringerAv(b.segs as any[]));
      let form: any = rute;
      try { const k = klippFlateBane(b); if (k) form = pc.intersection(rute, k); } catch { /* hele ruta */ }
      if (!form?.length) continue;
      const pk = (form as any).flat(2) as [number, number][];
      const r = { x0: Math.min(...pk.map((p) => p[0])), y0: Math.min(...pk.map((p) => p[1])),
        x1: Math.max(...pk.map((p) => p[0])), y1: Math.max(...pk.map((p) => p[1])) };
      const bMm = ((r.x1 - r.x0) / MM) * malestokk, hMm = ((r.y1 - r.y0) / MM) * malestokk;
      if (Math.max(bMm, hMm) < 100) continue;
      n++;
      const m = b.bilde.mat;
      // ppi i full stoerrelse: piksler over bildets bredde paa bilen (ikke i 1:30)
      const bildeBMm = (Math.hypot(m[0], m[1]) / MM) * malestokk;
      const ppi = b.bilde.px[0] / (bildeBMm / 25.4);
      const navn = `${vis.navn} bilde ${n}`;
      if (!b.bilde.jpeg) {
        merknader.push(`${navn}: bildet er ikke JPEG i skissen og kan ikke legges i printfila. Last opp originalbildet.`);
      }
      try {
        const doc = await PDFDocument.create();
        const marg = 6;
        const page = doc.addPage([r.x1 - r.x0 + 2 * marg, r.y1 - r.y0 + 2 * marg]);
        const dx = marg - r.x0, dy = marg - r.y0;
        const sti = (form as any).map((poly: any) => poly.map((ring: any) =>
          ring.map((p: [number, number], i: number) => `${(p[0] + dx).toFixed(3)} ${(p[1] + dy).toFixed(3)} ${i ? "l" : "m"}`).join("\n") + "\nh").join("\n")).join("\n");
        let ops = `0.5 0.5 0.5 rg\n${sti}\nf\n`;
        if (b.bilde.jpeg) {
          // bildet kopieres som det er (samme JPEG, kanaler og Decode), saa CMYK ikke blir invertert
          const bd = b.bilde;
          const imgDict: any = { Type: "XObject", Subtype: "Image", Width: bd.px[0], Height: bd.px[1],
            ColorSpace: bd.n === 4 ? "DeviceCMYK" : bd.n === 1 ? "DeviceGray" : "DeviceRGB", BitsPerComponent: 8, Filter: "DCTDecode" };
          if (bd.decode) imgDict.Decode = bd.decode;
          const imgRef = doc.context.register(doc.context.stream(bd.jpeg!, imgDict));
          const nm = String((page.node as any).newXObject("Im0", imgRef));
          ops += `q\n${sti}\nW n\n${m.map((v, i) => (i === 4 ? v + dx : i === 5 ? v + dy : v).toFixed(5)).join(" ")} cm\n${nm} Do\nQ\n`;
        }
        const strom = doc.context.flateStream(ops);
        page.node.set(PDFName.of("Contents"), doc.context.register(strom));
        doc.setKeywords([`signhub-bilde:${Math.round(ppi)}`]);
        const pdf = await doc.save();
        elementer.push({ id: `bilde-${n}`, vis: vis.navn, navn, pdf, breddeMm: Math.round(bMm), hoydeMm: Math.round(hMm),
          antall: 1, farger: [{ hex: "#808080", andel: 1 }], bilde: { ppi: Math.round(ppi), px: b.bilde.px, kilde: "skisse" } });
        logg.push(`${navn}: ${Math.round(bMm)} x ${Math.round(hMm)} mm, ${Math.round(ppi)} ppi i full stoerrelse.`);
        if (ppi < 60) merknader.push(`${navn}: bildet i skissen er ${Math.round(ppi)} ppi i full stoerrelse (${Math.round(bMm)} x ` +
          `${Math.round(hMm)} mm). Last opp originalbildet, minst 60 ppi i full stoerrelse.`);
      } catch (e: any) {
        merknader.push(`${navn}: bildet kunne ikke legges i en printfil (${String(e?.message ?? e)}).`);
      }
    }
  }

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
    elementer, utelatt, forside, merknader, logg, levendeTekst,
  };
}


/** Saa mange flater eller flere er tekst (bokstaver), ikke en stripe. */
const TEKST_FLATER = 4;
/** Saa stor overlapp mellom banens synlige ramme og rammen finnDekor valgte er samme bane. */
const LIK_BOKS_OVERLAPP = 0.95;
/** Saa mye lengre enn bred er en stripe. */
const STRIPE_FORHOLD_BIL = 8;

/**
 * Bare én side tegnet (Eirik 17.11.2026, E-Partner 306005: «designeren av
 * skissen har vaert lat og kun tegnet en side. men det skal motoren likevel
 * loese»). Elementene paa siden legges til for den andre siden. Tekst og
 * logo speilvendes aldri, de telles i `antall`. Striper og dekor i ordets
 * rette forstand speilvendes og blir egne elementer. Front og bak
 * dupliseres aldri. Motorens beste gjetning staar; usikre valg merkes paa
 * elementet og meldes, saa brukeren kan snu dem i appen.
 *
 *   flerfarget, eller minst TEKST_FLATER flater  -> tekst/logo, ikke speilet
 *   én farge, én eller to flater, stripe (8:1)   -> stripe, speilet
 *   ellers                                        -> én farge speiles, usikker
 */
async function dupliserSide(visninger: string[], elementer: BilElement[],
                            baner: Map<BilElement, Bane[]>, merknader: string[], logg: string[]) {
  const sider = visninger.filter((v) => v.startsWith("side"));
  if (sider.length !== 1) return;
  const side = sider[0];
  const nye: BilElement[] = [];
  const usikre: string[] = [];
  let riktig = 0, speilet = 0;
  for (const e of elementer.slice()) {
    if (e.vis !== side || e.sammeSom) continue;
    const bs = baner.get(e) ?? [];
    let flater = 0;
    for (const b of bs) flater += b.segs.filter((x: any) => x.t === "m").length;
    const lang = Math.max(e.breddeMm, e.hoydeMm), kort = Math.max(1, Math.min(e.breddeMm, e.hoydeMm));
    let speil: boolean, usikker = false, grunn: string;
    if (e.farger.length >= 2) { speil = false; grunn = "logo (flere farger)"; }
    else if (flater >= TEKST_FLATER) { speil = false; grunn = `tekst (${flater} flater)`; }
    else if (lang / kort >= STRIPE_FORHOLD_BIL) { speil = true; grunn = "stripe"; }
    else { speil = true; usikker = true; grunn = `${flater} flate${flater === 1 ? "" : "r"} i én farge, kan vaere et merke`; }
    if (!speil) {
      e.antall++;
      e.ensidig = { speilet: false, usikker, grunn };
      riktig++;
    } else {
      const xs = bs.flatMap((b) => [b.boks.x0, b.boks.x1]);
      const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
      const sp = (q: [number, number]): [number, number] => [2 * cx - q[0], q[1]];
      const kopi: Bane[] = bs.map((b) => ({
        ...b, klipp: undefined,
        segs: b.segs.map((x: any) => x.t === "c" ? { t: "c", a: sp(x.a), b: sp(x.b), c: sp(x.c) }
          : x.p ? { t: x.t, p: sp(x.p) } : { ...x }) as any,
        boks: { x0: 2 * cx - b.boks.x1, y0: b.boks.y0, x1: 2 * cx - b.boks.x0, y1: b.boks.y1 },
      }));
      const ny: BilElement = {
        ...e, id: e.id + "-speilet", navn: e.navn + " (andre siden, speilet)",
        pdf: await skrivPdf(kopi), antall: e.antall, passmerke: undefined,
        ensidig: { speilet: true, usikker, kilde: e.navn, grunn },
      };
      e.ensidig = { speilet: false, usikker, grunn: "kilde for speilet kopi" };
      baner.set(ny, kopi);
      nye.push(ny);
      speilet++;
    }
    if (usikker) usikre.push(`${e.navn} (${grunn}, motoren har ${speil ? "speilvendt" : "ikke speilvendt"})`);
  }
  if (!riktig && !speilet) return;
  elementer.push(...nye);
  logg.push(`Skissen viser bare én side. Elementene paa siden er lagt til for den andre siden: ` +
    `${riktig} tekst eller logo uten speilvending (antall oeket), ${speilet} speilvendt.`);
  if (usikre.length) merknader.push(`Usikker paa speilvending, kontroller: ${usikre.join("; ")}.`);
}

/** En bane delt i delbaner, en per «m», med egen ramme. */
/** proporsjonsavvik under dette er tegnenoeyaktighet, ikke en strukket logo */
const PROP_TOL = 0.03;
/** andel av delene som maa kjennes igjen i den andre forekomsten */
const PROP_TREFF = 0.9;
async function laasProporsjoner(elementer: BilElement[], baner: Map<BilElement, Bane[]>, logg: string[]) {
  type Del = { x0: number; y0: number; x1: number; y1: number; hex: string };
  const deler = new Map<BilElement, Del[]>();
  for (const e of elementer) {
    const bs = (baner.get(e) ?? []).filter((b) => b.fyll);
    const d: Del[] = [];
    for (const b of bs) for (const db of delbaner(b)) d.push({ ...db.boks, hex: baneHex(b.farge) });
    deler.set(e, d);
  }
  // E kartlagt inn i R: R = (sx, sy) * E + t. Gir sy/sx, eller null
  const mot = (E: Del[], R: Del[]): number | null => {
    if (E.length < 4 || R.length < E.length) return null;
    const ex0 = Math.min(...E.map((p) => p.x0)), ey0 = Math.min(...E.map((p) => p.y0));
    const ex1 = Math.max(...E.map((p) => p.x1)), ey1 = Math.max(...E.map((p) => p.y1));
    const areal = (p: Del) => (p.x1 - p.x0) * (p.y1 - p.y0);
    const anker = E.slice().sort((a, b) => areal(b) - areal(a))[0];
    const pw = anker.x1 - anker.x0, ph = anker.y1 - anker.y0;
    if (pw <= 0 || ph <= 0) return null;
    for (const q of R) {
      if (q.hex !== anker.hex) continue;
      const sx = (q.x1 - q.x0) / pw, sy = (q.y1 - q.y0) / ph;
      if (!(sx > 0 && sy > 0) || sx / sy > 3 || sy / sx > 3) continue;
      const tx = q.x0 - anker.x0 * sx, ty = q.y0 - anker.y0 * sy;
      const tol = 0.03 * Math.max((ex1 - ex0) * sx, (ey1 - ey0) * sy);
      let treff = 0;
      for (const p of E) {
        const m = { x0: p.x0 * sx + tx, x1: p.x1 * sx + tx, y0: p.y0 * sy + ty, y1: p.y1 * sy + ty };
        if (R.some((r) => r.hex === p.hex && Math.abs(r.x0 - m.x0) < tol && Math.abs(r.x1 - m.x1) < tol &&
          Math.abs(r.y0 - m.y0) < tol && Math.abs(r.y1 - m.y1) < tol)) treff++;
      }
      if (treff >= PROP_TREFF * E.length) return sy / sx;
    }
    return null;
  };
  const treff = new Map<BilElement, { r: BilElement; f: number }[]>();
  for (const e of elementer) {
    const E = deler.get(e)!;
    const liste: { r: BilElement; f: number }[] = [];
    for (const r of elementer) {
      if (r === e) continue;
      const f = mot(E, deler.get(r)!);
      if (f !== null) liste.push({ r, f });
    }
    treff.set(e, liste);
  }
  const lik = (f: number) => Math.abs(f - 1) <= PROP_TOL;
  for (const e of elementer) {
    const l = treff.get(e)!;
    const skjeve = l.filter((x) => !lik(x.f));
    if (!skjeve.length || skjeve.length !== l.length) continue;
    const f0 = skjeve[0].f;
    if (!skjeve.every((x) => Math.abs(x.f - f0) / f0 <= PROP_TOL)) continue;
    // de andre maa vaere enige seg imellom: minst to som stemmer med hverandre
    const enige = skjeve.some((x) => elementer.some((z) => z !== e && z !== x.r &&
      ((treff.get(x.r) ?? []).some((y) => y.r === z && lik(y.f)) || (treff.get(z) ?? []).some((y) => y.r === x.r && lik(y.f)))));
    if (!enige && skjeve.length < 2) continue;
    const f = skjeve.reduce((t, x) => t + x.f, 0) / skjeve.length;
    const bs = baner.get(e)!;
    const y0 = Math.min(...bs.map((b) => b.boks.y0));
    const sk = (p: [number, number]): [number, number] => [p[0], y0 + (p[1] - y0) * f];
    const nye: Bane[] = bs.map((b) => ({
      ...b, klipp: undefined,
      segs: (b.segs as any[]).map((x) => x.t === "c" ? { t: "c", a: sk(x.a), b: sk(x.b), c: sk(x.c) } : x.p ? { t: x.t, p: sk(x.p) } : { ...x }) as any,
      boks: { x0: b.boks.x0, x1: b.boks.x1, y0: y0 + (b.boks.y0 - y0) * f, y1: y0 + (b.boks.y1 - y0) * f },
    }));
    const foer = e.hoydeMm;
    e.pdf = await skrivPdf(nye);
    e.hoydeMm = Math.round(e.hoydeMm * f);
    baner.set(e, nye);
    logg.push(`${e.navn}: samme logo som ${skjeve.map((x) => x.r.navn).join(", ")}, men strukket i skissen. ` +
      `Hoeyden rettet fra ${foer} til ${e.hoydeMm} mm etter logoens proporsjoner, bredden ${e.breddeMm} mm staar.`);
  }
}

function delbaner(b: Bane): { kilde: Bane; segs: any[]; boks: Bane["boks"] }[] {
  const ut: { kilde: Bane; segs: any[]; boks: Bane["boks"] }[] = [];
  let cur: any[] = [];
  const lukk = () => {
    if (!cur.length) return;
    const pts: [number, number][] = [];
    for (const s of cur) { if (s.p) pts.push(s.p); if (s.a) pts.push(s.a, s.b, s.c); }
    if (pts.length) ut.push({ kilde: b, segs: cur, boks: {
      x0: Math.min(...pts.map((p) => p[0])), y0: Math.min(...pts.map((p) => p[1])),
      x1: Math.max(...pts.map((p) => p[0])), y1: Math.max(...pts.map((p) => p[1])) } });
    cur = [];
  };
  for (const s of b.segs as any[]) { if (s.t === "m") lukk(); cur.push(s); }
  lukk();
  return ut;
}

/**
 * Grupperer delbanene i deler som ligger naermere hverandre enn `glippe`
 * (tegnede enheter), og setter hver del sammen igjen til baner. Delbaner fra
 * samme bane i samme del blir samme bane igjen, saa hull i bokstaver (som
 * fylles etter partallsregelen) blir staaende som hull.
 */
export function delIDeler(baner: Bane[], glippe: number, mmPerEnhet?: number, paaFormen = false): Bane[][] {
  const d = baner.flatMap(delbaner);
  const p = d.map((_, i) => i);
  const f = (i: number): number => (p[i] === i ? i : (p[i] = f(p[i])));
  const av = (a: Bane["boks"], b: Bane["boks"]) => Math.hypot(
    Math.max(0, a.x0 - b.x1, b.x0 - a.x1), Math.max(0, a.y0 - b.y1, b.y0 - a.y1));
  /**
   * En stripe limes ikke fast i det som staar inntil den (Vito: bunnen av
   * «VILLANGER» naar ned til den roede stripen, og hele siden ble ett
   * element paa 3,5 m). Stripen staar som egen del; samleDeler slaar den
   * sammen med naboen bare naar den felles rammen ikke blir for luftig
   * (ÅTG-streken paa Kia hoerer fortsatt til bokstavene).
   */
  const stripe = (b: Bane["boks"]) => {
    const w = b.x1 - b.x0, h = b.y1 - b.y0, l = Math.max(w, h), t = Math.min(w, h);
    return l >= 8 * Math.max(t, 1e-9) && l >= 20 * glippe;
  };
  // en stor flate (den roede bak paa Vito) limes ikke fast i bokstavene inntil den
  const storFlate = (b: Bane["boks"]) => Math.min(b.x1 - b.x0, b.y1 - b.y0) > 40 * glippe;
  // ... men det som ligger oppaa flaten (bokstaver paa en plate, XL i ruta) hoerer til
  /**
   * ... saa lenge flaten er en plate og ikke et felt. Et felt lengre enn
   * det som faar plass paa tvers av rullen (Saethre ID.Buzz 17.11.2026: det
   * oransje feltet paa 4,2 m med «KVALITET I OVER 100 ÅR» oppaa) skjaeres
   * for seg, og teksten legges oppaa, som i produksjonen.
   */
  const felt = (b: Bane["boks"]) => mmPerEnhet !== undefined && storFlate(b) &&
    Math.max(b.x1 - b.x0, b.y1 - b.y0) * mmPerEnhet > MAKS_DEL_MM;
  const inniStor = (a: Bane["boks"], b: Bane["boks"], ulikFarge = true) => {
    const [st, sm] = storFlate(a) ? [a, b] : [b, a];
    if (felt(st) && ulikFarge) return false;
    const ox = Math.max(0, Math.min(st.x1, sm.x1) - Math.max(st.x0, sm.x0));
    const oy = Math.max(0, Math.min(st.y1, sm.y1) - Math.max(st.y0, sm.y0));
    return ox * oy >= 0.5 * (sm.x1 - sm.x0) * (sm.y1 - sm.y0);
  };
  /**
   * To felt kan ha overlappende rammer uten aa ligge inntil hverandre (de
   * oransje feltene paa Saethre, skilt av skraa striper i lakken). For felt
   * maales avstanden paa formen, ikke paa rammen.
   */
  const form = new Map<number, any>();
  const formAv = (i: number) => { if (!form.has(i)) { try { form.set(i, flateKlipp(ringerAv(d[i].segs as any[]))); } catch { form.set(i, null); } } return form.get(i); };
  const inntil = (i: number, j: number) => {
    if (!paaFormen || !(felt(d[i].boks) || felt(d[j].boks)) || !storFlate(d[i].boks) || !storFlate(d[j].boks)) return true;
    const a = formAv(i), b = formAv(j);
    if (!a?.length || !b?.length) return true;
    try { return (pc.intersection(utvidKlipp(a, FELT_GLIPPE_MM / mmPerEnhet!), b) as any[]).length > 0; } catch { return true; }
  };
  for (let i = 0; i < d.length; i++)
    for (let j = i + 1; j < d.length; j++)
      if (av(d[i].boks, d[j].boks) <= glippe && stripe(d[i].boks) === stripe(d[j].boks) &&
          (storFlate(d[i].boks) === storFlate(d[j].boks) ||
           inniStor(d[i].boks, d[j].boks, baneHex(d[i].kilde.farge) !== baneHex(d[j].kilde.farge))) && inntil(i, j)) p[f(i)] = f(j);
  const grupper = new Map<number, typeof d>();
  d.forEach((x, i) => { const r = f(i); if (!grupper.has(r)) grupper.set(r, []); grupper.get(r)!.push(x); });
  return [...grupper.values()].map((g) => {
    const perKilde = new Map<Bane, typeof d>();
    for (const x of g) { if (!perKilde.has(x.kilde)) perKilde.set(x.kilde, []); perKilde.get(x.kilde)!.push(x); }
    // behold tegnerekkefoelgen
    return baner.filter((b) => perKilde.has(b)).map((b) => {
      const xs = perKilde.get(b)!;
      return { ...b, segs: xs.flatMap((x) => x.segs), boks: {
        x0: Math.min(...xs.map((x) => x.boks.x0)), y0: Math.min(...xs.map((x) => x.boks.y0)),
        x1: Math.max(...xs.map((x) => x.boks.x1)), y1: Math.max(...xs.map((x) => x.boks.y1)) } } as Bane;
    });
  });
}


/**
 * Smaleste bredde paa banene naar de kan dreies inntil STOR_GRAD (i
 * skissens enheter). En logo skraadd 20° (Vito) er 1,2 m hoey slik den
 * staar, men 0,6 m langs sin egen grunnlinje.
 */
const STOR_GRAD = 35;
/** stor helning brukes naar rammen da blir under denne andelen */
const STOR_GEVINST = 0.75;
function minsteBredde(baner: Bane[], maks = STOR_GRAD): number {
  const pts: [number, number][] = [];
  for (const b of baner) for (const sg of b.segs as any[]) { if (sg.p) pts.push(sg.p); if (sg.c) pts.push(sg.a, sg.b, sg.c); }
  if (!pts.length) return 0;
  let best = Infinity;
  for (let g = -maks; g <= maks; g += 1) {
    const r = (g * Math.PI) / 180, c = Math.cos(r), sn = Math.sin(r);
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const [x, y] of pts) {
      const X = c * x - sn * y, Y = sn * x + c * y;
      if (X < x0) x0 = X; if (X > x1) x1 = X; if (Y < y0) y0 = Y; if (Y > y1) y1 = Y;
    }
    best = Math.min(best, Math.min(x1 - x0, y1 - y0));
  }
  return best;
}

/** minste helning som rettes opp, og minste gevinst i ramme */
const RETT_MIN_GRAD = 0.3;
const RETT_MAKS_GRAD = 6;

/**
 * Retter opp et element som er skraadd for aa foelge karosseriet (Eirik
 * 16.11.2026). Paa Kia PV5 heller stripen 1,6°, og den 40 mm hoye stripen
 * fikk en ramme paa 106 mm. Rettet opp skjaeres den i sin egen hoyde.
 *
 * Vinkelen er den som gir minst omsluttende rektangel, soekt innenfor
 * ±RETT_MAKS_GRAD. Elementet roteres bare naar vinkelen er minst
 * RETT_MIN_GRAD og rammen krymper minst RETT_MIN_GEVINST; en logo som
 * staar rett, eller nesten rett, roeres ikke.
 */
function rettOpp(baner: Bane[], maksGrad = RETT_MAKS_GRAD, fastGrad?: number): { baner: Bane[]; vinkel: number; spartProsent: number; funnet?: boolean; linje?: number; styrke?: number } {
  const pts: [number, number][] = [];
  for (const b of baner) for (const s of b.segs as any[]) { if (s.p) pts.push(s.p); if (s.a) pts.push(s.a, s.b, s.c); }
  if (pts.length < 3) return { baner, vinkel: 0, spartProsent: 0 };
  const cx = pts.reduce((a, p) => a + p[0], 0) / pts.length, cy = pts.reduce((a, p) => a + p[1], 0) / pts.length;
  const flate = (grad: number) => {
    const r = (grad * Math.PI) / 180, c = Math.cos(r), sn = Math.sin(r);
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const [x, y] of pts) {
      const X = c * (x - cx) - sn * (y - cy), Y = sn * (x - cx) + c * (y - cy);
      if (X < x0) x0 = X; if (X > x1) x1 = X; if (Y < y0) y0 = Y; if (Y > y1) y1 = Y;
    }
    return (x1 - x0) * (y1 - y0);
  };
  const null0 = flate(0);
  /*
   * Vinkelen leses av grunnlinjen (Eirik 16.11.2026: «tenk alltid
   * baseline»): de rette kantene som er en underkant, altsaa har formen over
   * seg og luft under. Runde bokstaver med buet bunn har ingen rett
   * underkant og stemmer ikke. Kursiv (ÅTG, åtg.no) har rette, vannrette
   * bunner og staar derfor rett. Paa A-en paa doerene er det foettene, paa
   * en stripe underkanten, paa tekst bunnen av R, E, L og T.
   */
  const inni = (bb: Bane, x: number, y: number) => {
    let inn = false;
    let start: [number, number] | null = null, forr: [number, number] | null = null;
    const kant = (p: [number, number], q: [number, number]) => {
      if ((p[1] > y) !== (q[1] > y) && x < p[0] + ((y - p[1]) * (q[0] - p[0])) / (q[1] - p[1])) inn = !inn;
    };
    for (const sg of bb.segs as any[]) {
      if (sg.t === "m") { if (forr && start) kant(forr, start); start = sg.p; forr = sg.p; }
      else if (sg.t === "l") { kant(forr!, sg.p); forr = sg.p; }
      else if (sg.t === "c") { kant(forr!, sg.c); forr = sg.c; }
      else if (sg.t === "h") { if (forr && start) kant(forr, start); forr = start; }
    }
    if (forr && start) kant(forr, start);
    return inn;
  };
  const stemmer = new Map<number, number>();
  const vinkelSum = new Map<number, number>();
  let bredde = 0;
  {
    const xs = pts.map((p) => p[0]); bredde = Math.max(...xs) - Math.min(...xs);
  }
  for (const bb of baner) {
    if (!bb.fyll) continue;
    let forrige: [number, number] | null = null;
    for (const sg of bb.segs as any[]) {
      if (sg.t === "m") { forrige = sg.p; continue; }
      if (sg.t === "l" && forrige) {
        const dx = sg.p[0] - forrige[0], dy = sg.p[1] - forrige[1], len = Math.hypot(dx, dy);
        let g = (Math.atan2(dy, dx) * 180) / Math.PI;
        if (g > 90) g -= 180; if (g < -90) g += 180;
        if (len > 0 && Math.abs(g) <= maksGrad) {
          const mx = (sg.p[0] + forrige[0]) / 2, my = (sg.p[1] + forrige[1]) / 2;
          const e = 0.1;   // tegnede punkter: tynt nok for en tynn stripe
          // underkant: formen over, luft under (y peker opp i PDF)
          if (inni(bb, mx, my + e) && !inni(bb, mx, my - e)) {
            const k = Math.round(g * 10); stemmer.set(k, (stemmer.get(k) ?? 0) + len);
            vinkelSum.set(k, (vinkelSum.get(k) ?? 0) + g * len);
          }
        }
      }
      if (sg.p) forrige = sg.p; else if (sg.c) forrige = sg.c;
    }
  }
  let mode = 0, modeV = -1;
  for (const [k] of stemmer) {
    let v = 0; for (let d = -2; d <= 2; d++) v += stemmer.get(k + d) ?? 0;
    if (v > modeV) { modeV = v; mode = k; }
  }
  let sv = 0, sw = 0;
  for (let d = -2; d <= 2; d++) { sv += vinkelSum.get(mode + d) ?? 0; sw += stemmer.get(mode + d) ?? 0; }
  // grunnlinjen maa vaere en reell del av bredden for aa telle
  const best = fastGrad ?? (sw > 0 && modeV >= 0.05 * bredde ? -sv / sw : 0);
  const bestA = flate(best);
  const gevinst = 1 - bestA / Math.max(null0, 1e-9);
  // grunnlinjen avgjoer; gevinsten i ramme meldes bare
  const funnet = sw > 0 && modeV >= 0.05 * bredde;
  const styrke = modeV / Math.max(bredde, 1e-9);
  if (Math.abs(best) < RETT_MIN_GRAD) return { baner, vinkel: 0, spartProsent: 0, funnet, linje: best, styrke };
  const r = (best * Math.PI) / 180, c = Math.cos(r), sn = Math.sin(r);
  const rot = (p: [number, number]): [number, number] =>
    [cx + c * (p[0] - cx) - sn * (p[1] - cy), cy + sn * (p[0] - cx) + c * (p[1] - cy)];
  const ut = baner.map((b) => {
    const segs = (b.segs as any[]).map((s) => s.t === "c" ? { t: "c", a: rot(s.a), b: rot(s.b), c: rot(s.c) }
      : s.p ? { t: s.t, p: rot(s.p) } : s);
    const q: [number, number][] = [];
    for (const s of segs) { if (s.p) q.push(s.p); if (s.a) q.push(s.a, s.b, s.c); }
    return { ...b, segs, boks: { x0: Math.min(...q.map((p) => p[0])), y0: Math.min(...q.map((p) => p[1])),
      x1: Math.max(...q.map((p) => p[0])), y1: Math.max(...q.map((p) => p[1])) } } as Bane;
  });
  return { baner: ut, vinkel: best, spartProsent: gevinst * 100, funnet, linje: best, styrke };
}

/** delene innenfor denne avstanden (ekte mm) kan hoere sammen */
const DEL_GLIPPE_MM = 50;
/** under denne avstanden er det samme del (bokstav og hull, ring og A) */
const DEL_FIN_MM = 10;
/**
 * Felt naermere hverandre enn dette er ett stykke (bilfiguren paa Rydd
 * Bergen er tegnet i biter med smale glipper). Lenger fra hverandre er de
 * skilt av lakken og skjaeres hver for seg (Saethre: 30 til 50 mm).
 */
const FELT_GLIPPE_MM = 20;
/** et felt lengre enn dette kuttes ved klippebanen som en stripe */
const FELT_KLIPP_MM = 1.5 * 1150;
/** felles ramme over dette ganger delenes egne rammer: for mye luft */
const DEL_LUFT = 2;
/** en skjoet i bilen krysser hele stripen innenfor dette (ekte mm), og ligger minst SKJOT_KANT_MM fra endene */
const SKJOT_TOL_MM = 15;
const SKJOT_KANT_MM = 200;
/** tekst med grunnlinjer som avviker mer enn dette, er ikke samme tekst (grader) */
const TEKST_VINKEL = 5;
/** Faerre flater enn dette: retningen er for usikker til aa skille deler paa. */
const KORT_ORD_FLATER = 4;
const KORT_ORD_VINKEL = 12;
/** grunnlinje kortere enn dette ganger bredden, langt fra aksene, gir ingen retning */
const SVAK_GRUNNLINJE = 0.2;
/** Saa mye av foerste og siste hoeye tegn ligger med i logoen som passmerke. */
const TEKST_STUBB_MM = 10;
/** stubbens biter: minst saa stor andel av den stoerste, og minst saa tykke (ekte mm) */
const STUBB_MIN_ANDEL = 0.3;
const STUBB_MIN_MM = 3;
/** tekst med bokstaver mer enn dette ganger hoeyere, er ikke samme tekst */
const TEKST_HOYDE = 1.8;
/** linjer i samme tekst kan staa opptil dette ganger bokstavhoeyden fra hverandre */
const TEKST_LINJE = 1.2;
/** bredeste del som faar plass paa tvers av rullen (1260 minus kant og regmarks) */
const MAKS_DEL_MM = 1150;
/** en flate tykkere enn dette (ekte mm) er en stor flate, ikke tekst */
const STOR_FLATE_MM = 400;
/** naboen maa spenne over minst denne andelen av stripen for aa vaere samme element */
const STRIPE_SPENN = 0.9;

/**
 * Sperret tekst er én tekst (Eirik 18.11.2026, Rydd Bergen: «R Y D D I N G
 * O G  B O S S K J Ø R I N G» og «92 83 27 82» kom som enkeltbokstaver og
 * ga «et realt puslespill» å montere). Glippen mellom tegnene er over
 * DEL_GLIPPE_MM, saa avstand alene holder dem ikke sammen. Kjennetegn paa
 * en tekstlinje: deler i samme farge, like hoeye (bokstavhoeyde), paa samme
 * grunnlinje eller midtlinje, etter hverandre med glipper under
 * TEKST_SPERR ganger bokstavhoeyden (ordmellomrom inkludert), og minst
 * TEKST_SPERR_TEGN deler. Linja leveres hel; kjorJobb skjoeter den i
 * mellomrommet mellom bokstavene naar den er lengre enn rullen.
 */
const TEKST_SPERR = 4.5;
/** rent mellomrom mellom en logo og en tekstblokk ved siden av (ekte mm) */
const MIN_BAND_MM = 5;
/** bilens linjer i mellomrommet dekker minst saa mye av delens bredde: profil, skill delene */
const PROFIL_DEKK = 0.9;

function profilDel(d: Bane[], minGlipe: number, bil: Bane[], o: { vis: string; navn: string }, logg: string[]): Bane[][] {
  if (d.length < 2) return [d];
  const r = { x0: Math.min(...d.map((b) => b.boks.x0)), y0: Math.min(...d.map((b) => b.boks.y0)),
    x1: Math.max(...d.map((b) => b.boks.x1)), y1: Math.max(...d.map((b) => b.boks.y1)) };
  for (const akse of ["y", "x"] as const) {
    const lo = (b: Bane) => akse === "y" ? b.boks.y0 : b.boks.x0, hi = (b: Bane) => akse === "y" ? b.boks.y1 : b.boks.x1;
    const [t0, t1] = akse === "y" ? [r.x0, r.x1] : [r.y0, r.y1];
    const sortert = d.slice().sort((a, b) => lo(a) - lo(b));
    let maks = -Infinity;
    for (let k = 0; k < sortert.length - 1; k++) {
      maks = Math.max(maks, hi(sortert[k]));
      const g0 = maks, g1 = lo(sortert[k + 1]);
      if (g1 - g0 < minGlipe) continue;
      // intervallene paa tvers som bilens linjer dekker inne i mellomrommet
      const iv: [number, number][] = [];
      for (const b of bil) {
        if (hi(b) < g0 || lo(b) > g1) continue;
        let fra: Pt | null = null, start: Pt | null = null, fp: Pt | null = null;
        for (const sg of b.segs as any[]) {
          if (sg.t === "h") { if (fra && start) legg(fra, start); fra = start; continue; }
          if (sg.t === "c" && fra) {
            // kurven deles i 8 korder
            for (let n = 1; n <= 8; n++) {
              const t = n / 8, u = 1 - t;
              const q: Pt = [u * u * u * fra[0] + 3 * u * u * t * sg.a[0] + 3 * u * t * t * sg.b[0] + t * t * t * sg.c[0],
                u * u * u * fra[1] + 3 * u * u * t * sg.a[1] + 3 * u * t * t * sg.b[1] + t * t * t * sg.c[1]];
              legg(n === 1 ? fra : fp!, q); fp = q;
            }
            fra = sg.c; continue;
          }
          if (!sg.p) continue;
          if (sg.t === "m") { fra = sg.p; start = sg.p; continue; }
          if (fra) legg(fra, sg.p);
          fra = sg.p;
        }
      }
      function legg(p: Pt, q: Pt) {
        const [pa, pt] = akse === "y" ? [p[1], p[0]] : [p[0], p[1]];
        const [qa, qt] = akse === "y" ? [q[1], q[0]] : [q[0], q[1]];
        const a0 = Math.max(g0, Math.min(pa, qa)), a1 = Math.min(g1, Math.max(pa, qa));
        if (a0 > a1) return;
        if (Math.abs(qa - pa) < 1e-9) { iv.push([Math.min(pt, qt), Math.max(pt, qt)]); return; }
        const u = (v: number) => pt + (qt - pt) * (v - pa) / (qa - pa);
        iv.push([Math.min(u(a0), u(a1)), Math.max(u(a0), u(a1))]);
      }
      iv.sort((p, q) => p[0] - q[0]);
      let dekt = 0, cur = t0;
      for (const [p, q] of iv) { const a = Math.max(p, cur), b = Math.min(q, t1); if (b > a) { dekt += b - a; cur = b; } }
      if (dekt < PROFIL_DEKK * (t1 - t0)) continue;
      const A = sortert.slice(0, k + 1), B = sortert.slice(k + 1);
      logg.push(`${o.vis} ${o.navn}: en av bilens linjer gaar i mellomrommet mellom delene og er en profil i karosseriet. Delene skjaeres hver for seg.`);
      return [...profilDel(A, minGlipe, bil, o, []), ...profilDel(B, minGlipe, bil, o, [])];
    }
  }
  return [d];
}
/** tekstblokken skilles ut fra logoen naar logoens ramme blir minst saa mye mindre */
const DEL_SPAR = 0.25;
/** mellomrommet maa vaere minst saa stort som andel av tekstens tegnhoeyde */
const BAND_MOT_TEGN = 0.4;
/** tekstens tegn (median, minste side) er hoeyst saa stor andel av logoens minste side */
const BAND_TEGN_LOGO = 0.25;
const TEKST_SPERR_TEGN = 4;
const TEKST_SPERR_MAKS_MM = 300;
function tekstlinjer(g: Bane[][], mmPerEnhet: number): Bane[][] {
  const info = g.map((d) => {
    const fyll = d.filter((b) => b.fyll);
    const hexer = new Set(fyll.map((b) => baneHex(b.farge)));
    const bb = { x0: Math.min(...d.map((b) => b.boks.x0)), y0: Math.min(...d.map((b) => b.boks.y0)),
      x1: Math.max(...d.map((b) => b.boks.x1)), y1: Math.max(...d.map((b) => b.boks.y1)) };
    const h = bb.y1 - bb.y0, w = bb.x1 - bb.x0;
    const ok = hexer.size === 1 && fyll.length > 0 && h * mmPerEnhet <= TEKST_SPERR_MAKS_MM && w > 0;
    return { bb, h, hex: ok ? [...hexer][0] : null };
  });
  const p = g.map((_, i) => i);
  const rot = (i: number): number => p[i] === i ? i : (p[i] = rot(p[i]));
  for (let i = 0; i < g.length; i++) {
    const a = info[i];
    if (!a.hex) continue;
    // naermeste nabo til hoeyre paa samme linje
    let best = -1, bestGap = Infinity;
    for (let j = 0; j < g.length; j++) {
      const b = info[j];
      if (j === i || b.hex !== a.hex) continue;
      const hm = Math.max(a.h, b.h);
      if (Math.min(a.h, b.h) < 0.65 * hm) continue;
      const linje = Math.abs(a.bb.y0 - b.bb.y0) <= 0.25 * hm || Math.abs(a.bb.y1 - b.bb.y1) <= 0.25 * hm;
      const gap = b.bb.x0 - a.bb.x1;
      if (!linje || gap < -0.2 * hm || gap > TEKST_SPERR * hm) continue;
      if (gap < bestGap) { bestGap = gap; best = j; }
    }
    if (best >= 0) p[rot(i)] = rot(best);
  }
  const kl = new Map<number, number[]>();
  g.forEach((_, i) => { const r = rot(i); if (!kl.has(r)) kl.set(r, []); kl.get(r)!.push(i); });
  const ut: Bane[][] = [];
  for (const ix of kl.values()) {
    if (ix.length >= TEKST_SPERR_TEGN) ut.push(ix.flatMap((i) => g[i]));
    else for (const i of ix) ut.push(g[i]);
  }
  return ut;
}

function samleDeler(baner: Bane[], fin: number, glippe: number, ok?: (g: Bane[]) => boolean,
                    par?: (a: Bane[], b: Bane[]) => boolean): Bane[][] {
  /**
   * Formen maales bare naar delen er for stor og deles paa nytt (ok er
   * satt): da er det en side med felt (Saethre), ikke en figur som er
   * tegnet i flere biter med smale glipper (bilfiguren paa Rydd Bergen).
   */
  const paaFormen = !!ok;
  let g = delIDeler(baner, fin, DEL_GLIPPE_MM / glippe, paaFormen);
  g = tekstlinjer(g, DEL_GLIPPE_MM / glippe);
  /**
   * Hva hoerer sammen? (Eirik 16.11.2026, Vito: «24 timers service:» og
   * «41770011» er én gruppe, logoen en annen, «men hvorfor? det er jo det
   * som er kunsten å svare på»). Svaret: det som er skrevet i samme
   * retning og i samme stoerrelse, er én tekst. Logoen er skraadd 20° og
   * har dobbelt saa hoeye bokstaver som telefonnummeret ved siden av, saa
   * den er noe annet selv om den staar inntil. Hver del faar grunnlinjens
   * vinkel (der den har en) og bokstavhoeydene sine; to deler med ulik
   * retning, eller to tekster med ulik bokstavhoeyde, slaas ikke sammen.
   */
  type Info = { vinkel: number | null; hoyder: number[]; kort?: boolean };
  // tekst paa hoykant (taket): grunnlinjen leses ogsaa med banene dreid 90°
  const dreid = (gg: Bane[]) => gg.map((b) => {
    const r = (p: [number, number]): [number, number] => [-p[1], p[0]];
    const segs = (b.segs as any[]).map((sg) => sg.t === "c" ? { t: "c", a: r(sg.a), b: r(sg.b), c: r(sg.c) } : sg.p ? { t: sg.t, p: r(sg.p) } : sg);
    return { ...b, segs, boks: { x0: -b.boks.y1, y0: b.boks.x0, x1: -b.boks.y0, y1: b.boks.x1 } } as Bane;
  });
  const infoAv = (gg: Bane[]): Info => {
    const flater = gg.reduce((n, b) => n + (b.segs as any[]).filter((x) => x.t === "m").length, 0);
    const r0 = rettOpp(gg, STOR_GRAD);
    // paa hoykant bare naar det er tekst og ingen grunnlinje liggende
    // tekst paa hoykant: flere tegn, og mye hoeyere enn bred
    const bw = Math.max(...gg.map((b) => b.boks.x1)) - Math.min(...gg.map((b) => b.boks.x0));
    const bh = Math.max(...gg.map((b) => b.boks.y1)) - Math.min(...gg.map((b) => b.boks.y0));
    // et kort ord paa hoykant («Din» paa toppen av LTS) er bare litt hoeyere
    // enn bredt: les det begge veier og bruk den sterkeste grunnlinjen
    const r9 = flater >= 3 && bh > 1.2 * bw ? rettOpp(dreid(gg), STOR_GRAD) : null;
    // kursive stammer i tekst paa hoykant leses som skraa grunnlinjer (11°):
    // en grunnlinje naer aksen vinner over en skraa
    const naerAkse = (x: typeof r0) => x.funnet && Math.abs(x.linje ?? 0) <= RETT_MAKS_GRAD;
    const r = r9 && (bh > 2 * bw || !r0.funnet || (naerAkse(r9) && !naerAkse(r0)) ||
      (r9.funnet && naerAkse(r9) === naerAkse(r0) && (r9.styrke ?? 0) > (r0.styrke ?? 0))) ? r9 : r0;
    let v = r.funnet ? (r.linje ?? 0) + (r === r9 ? 90 : 0) : null;
    /**
     * En svak grunnlinje langt fra vannrett eller loddrett er ikke en
     * retning. Ikonene i smoerbroedlista bak paa Oesterboe (Vito 304160) ga
     * 118° fra et par rette streker i haken og lynet, og ble ikke slaatt
     * sammen med tekstene sine. Ekte skraadde logoer staar sterkt (Vito
     * sort: over 1,3 ganger bredden).
     */
    if (v !== null && (r.styrke ?? 1) < SVAK_GRUNNLINJE) {
      const a = Math.abs(v) % 90;
      if (Math.min(a, 90 - a) > TEKST_VINKEL) v = null;
    }
    /**
     * Et kort ord (to, tre tegn som «56» og «39» i et telefonnummer paa
     * E-Partner 306005) har ikke nok grunnlinje til aa si noe sikkert om
     * retningen. Da regnes retningen som ukjent, og ordet kan slaas sammen
     * med resten av linja.
     */
    // (beholdes, men sammenlignes med romsligere grense i ulikTekst)
    // en strek (ikke tekst) har retningen til sin lange akse, ikke til enden
    // (den gronne streken under ÅTG paa taket staar paa hoykant)
    if (flater < 3 && Math.max(bw, bh) >= 3 * Math.min(bw, bh)) {
      const t = Math.min(...gg.map((b) => b.boks.y0)), u = Math.max(...gg.map((b) => b.boks.y1));
      void t; void u;
      v = bw >= bh ? (r0.funnet ? (r0.linje ?? 0) : 0) : 90;
    }
    // bokstavhoeyden: korteste side av hver flate, med teksten rettet opp
    const hoyder = delbaner_hoyder(r.funnet ? r.baner : gg, r.funnet);
    return { vinkel: v, hoyder, kort: flater < KORT_ORD_FLATER };
  };
  let info = g.map((x) => infoAv(x));
  // bokstavhoeyden: 75-persentilen, saa smaa tegn (punktum, kolon) ikke trekker ned
  const median = (xs: number[]) => xs.slice().sort((a, b) => a - b)[Math.floor(xs.length * 0.75)];
  const tekst = (a: Info) => a.hoyder.length >= 3;
  function delbaner_hoyder(gg: Bane[], rettet: boolean): number[] {
    const hs: number[] = [];
    for (const b of gg) {
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, har = false;
      const slutt = () => { if (har) hs.push(rettet ? y1 - y0 : Math.min(x1 - x0, y1 - y0)); x0 = y0 = Infinity; x1 = y1 = -Infinity; har = false; };
      for (const sg of b.segs as any[]) {
        if (sg.t === "m") slutt();
        for (const q of sg.t === "c" ? [sg.a, sg.b, sg.c] : sg.p ? [sg.p] : []) {
          har = true; x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]); y0 = Math.min(y0, q[1]); y1 = Math.max(y1, q[1]);
        }
      }
      slutt();
    }
    // smaa flater (hull i bokstaver, prikker) teller ikke som bokstaver
    const maks = Math.max(...hs, 0);
    return hs.filter((h) => h > 0.3 * maks);
  }
  const ulikTekst = (a: Info, b: Info, ra: Bane["boks"], rb: Bane["boks"]) => {
    if (a.vinkel !== null && b.vinkel !== null) {
      // modulo 90: en firkant (XL-boksen) har ingen sikker side opp, og paa
      // taket staar alt paa hoykant (e-expert, panseret)
      const d = Math.abs(a.vinkel - b.vinkel) % 90;
      // et kort ord har usikker retning: romsligere grense, men en skraadd
      // logo (Vito, 20°) tar fortsatt ikke med seg sifre fra telefonnummeret
      if (Math.min(d, 90 - d) > (a.kort || b.kort ? KORT_ORD_VINKEL : TEKST_VINKEL)) return true;
    }
    // en flate som er tykkere enn bokstavene, er ikke en strek under teksten
    // (Vito bak: den roede og den hvite flaten er ikke en del av logoen)
    const tykk = (r: Bane["boks"]) => Math.min(r.x1 - r.x0, r.y1 - r.y0);
    // og stoerre enn teksten selv (et ikon ved siden av teksten hoerer til)
    const ar = (r: Bane["boks"]) => (r.x1 - r.x0) * (r.y1 - r.y0);
    if (tekst(a) && !tekst(b) && tykk(rb) > TEKST_HOYDE * median(a.hoyder) && ar(rb) > ar(ra)) return true;
    if (tekst(b) && !tekst(a) && tykk(ra) > TEKST_HOYDE * median(b.hoyder) && ar(ra) > ar(rb)) return true;
    return false;
  };
  /** linjeavstanden i en tekst kan vaere stoerre enn glippen naar bokstavene er store */
  const glippeFor = (a: Info, b: Info) => tekst(a) && tekst(b)
    ? Math.max(glippe, TEKST_LINJE * Math.min(median(a.hoyder), median(b.hoyder))) : glippe;
  // glippe er DEL_GLIPPE_MM i tegnede enheter: derfra maalestokken
  const ekteMm = (v: number) => (v / glippe) * DEL_GLIPPE_MM;
  const hexer = (gg: Bane[]) => new Set(gg.filter((b) => b.fyll).map((b) => baneHex(b.farge)));
  /** felt (lengre enn rullen er bred) maales paa formen: rammene kan overlappe uten at feltene moetes */
  const erFelt = (gg: Bane[]) => gg.some((q) => q.fyll &&
    ekteMm(Math.max(q.boks.x1 - q.boks.x0, q.boks.y1 - q.boks.y0)) > MAKS_DEL_MM &&
    ekteMm(Math.min(q.boks.x1 - q.boks.x0, q.boks.y1 - q.boks.y0)) > STOR_FLATE_MM);
  const formCache = new Map<Bane[], any>();
  const formAv = (gg: Bane[]) => {
    if (!formCache.has(gg)) {
      try {
        const fl = gg.filter((q) => q.fyll).map((q) => flateKlipp(ringerAv(q.segs as any[]))).filter((x: any) => x?.length);
        formCache.set(gg, fl.length ? pc.union(...fl) : null);
      } catch { formCache.set(gg, null); }
    }
    return formCache.get(gg);
  };
  // to felt hoerer sammen bare naar de faktisk henger sammen (innenfor fin), ikke over en stripe i lakken
  const feltInntil = (a: Bane[], b: Bane[]) => {
    if (!paaFormen || (!erFelt(a) && !erFelt(b))) return true;
    const fa = formAv(a), fb = formAv(b);
    if (!fa?.length || !fb?.length) return true;
    try { return (pc.intersection(utvidKlipp(fa, (FELT_GLIPPE_MM / DEL_GLIPPE_MM) * glippe), fb) as any[]).length > 0; } catch { return true; }
  };
  const storFelt = (a: Bane[], b: Bane[]) => {
    const fa = hexer(a);
    if (fa.size !== 1 || ![...hexer(b)].some((h) => !fa.has(h))) return false;
    const r = ramme(a), rb = ramme(b);
    return a.some((q) => q.fyll && ekteMm(Math.min(q.boks.x1 - q.boks.x0, q.boks.y1 - q.boks.y0)) > STOR_FLATE_MM) &&
      ar(rb) < 0.25 * ar(r);
  };
  const ramme = (bs: Bane[]) => ({
    x0: Math.min(...bs.map((b) => b.boks.x0)), y0: Math.min(...bs.map((b) => b.boks.y0)),
    x1: Math.max(...bs.map((b) => b.boks.x1)), y1: Math.max(...bs.map((b) => b.boks.y1)) });
  const ar = (r: Bane["boks"]) => (r.x1 - r.x0) * (r.y1 - r.y0);
  const av = (a: Bane["boks"], b: Bane["boks"]) => Math.hypot(
    Math.max(0, a.x0 - b.x1, b.x0 - a.x1), Math.max(0, a.y0 - b.y1, b.y0 - a.y1));
  for (;;) {
    let best: [number, number, number] | null = null;
    for (let i = 0; i < g.length; i++) for (let j = i + 1; j < g.length; j++) {
      const ri = ramme(g[i]), rj = ramme(g[j]);
      const d = av(ri, rj);
      if (d > glippeFor(info[i], info[j])) continue;
      const felles = ar(ramme([...g[i], ...g[j]]));
      if (felles > DEL_LUFT * (ar(ri) + ar(rj))) continue;
      /**
       * En stripe hoerer bare til naboen naar naboen spenner over det meste
       * av stripen (ÅTG over den gronne streken paa Kia). Paa Vito staar
       * logoen paa én del av en 2,5 m lang stripe: de skjaeres hver for seg.
       */
      const langs = (r: Bane["boks"]) => Math.max(r.x1 - r.x0, r.y1 - r.y0);
      // en stripe er én flate (eller to), ikke en tekstlinje med mange bokstaver
      const flater = (gg: Bane[]) => gg.reduce((a, b) => a + (b.segs as any[]).filter((x) => x.t === "m").length, 0);
      const erStripe = (r: Bane["boks"], gg: Bane[]) => flater(gg) <= 2 &&
        langs(r) >= 8 * Math.min(r.x1 - r.x0, r.y1 - r.y0) && langs(r) >= 20 * fin;
      const spenn = (a: Bane["boks"], st: Bane["boks"]) => (st.x1 - st.x0 >= st.y1 - st.y0 ? a.x1 - a.x0 : a.y1 - a.y0);
      if ((erStripe(ri, g[i]) && spenn(rj, ri) < STRIPE_SPENN * langs(ri)) ||
          (erStripe(rj, g[j]) && spenn(ri, rj) < STRIPE_SPENN * langs(rj))) continue;
      if (ok && !ok([...g[i], ...g[j]])) continue;
      if (par && !par(g[i], g[j])) continue;
      if (ulikTekst(info[i], info[j], ri, rj)) { continue; }
      /**
       * Et stort felt (tykkere enn STOR_FLATE_MM) tar ikke med seg bokstaver
       * i en annen farge som staar oppaa det (Saethre ID.Buzz 17.11.2026:
       * «KVALITET I OVER 100 ÅR» i graatt over det oransje feltet). Bokstav
       * for bokstav saa ingen av dem ut som tekst, og hele feltet og teksten
       * ble ett element paa 6,5 m. Feltet skjaeres for seg, teksten for seg
       * og legges oppaa, som i produksjonen.
       */
      if (storFelt(g[i], g[j]) || storFelt(g[j], g[i])) continue;
      if (!feltInntil(g[i], g[j])) continue;
      /**
       * Paa samme linje foerst (Oesterboe, Vito 304160: smoerbroedlista med
       * ikon foran hver linje). Med naermeste par foerst ble ikonene slaatt
       * sammen til en soeyle, og soeylen fikk ikke bli med noen linje fordi
       * rammen ble for luftig. Et par som ligger paa samme linje i tekstens
       * retning, velges foer et par som staar over hverandre.
       */
      const hoykant = [info[i].vinkel, info[j].vinkel].some((v) => v !== null && Math.abs(Math.abs(v) - 90) < 20);
      const o0 = hoykant ? Math.max(ri.x0, rj.x0) : Math.max(ri.y0, rj.y0);
      const o1 = hoykant ? Math.min(ri.x1, rj.x1) : Math.min(ri.y1, rj.y1);
      const tv = hoykant ? Math.min(ri.x1 - ri.x0, rj.x1 - rj.x0) : Math.min(ri.y1 - ri.y0, rj.y1 - rj.y0);
      const sammeLinje = o1 - o0 >= 0.5 * tv;
      const noekkel = sammeLinje ? d : d + glippe;
      if (!best || noekkel < best[2]) best = [i, j, noekkel];
    }
    if (!best) break;
    const [i, j] = best;
    // samme bane delt paa to deler blir en bane igjen
    const samlet = [...g[i], ...g[j]];
    g = g.filter((_, k) => k !== i && k !== j);
    info = info.filter((_, k) => k !== i && k !== j);
    const ny = slaaSammenBaner(samlet, baner);
    g.push(ny);
    info.push(infoAv(ny));
  }
  return g;
}

/** Baner som kommer fra samme opprinnelige bane slaas sammen, i tegnerekkefoelge. */
function slaaSammenBaner(deler: Bane[], original: Bane[]): Bane[] {
  const ut: Bane[] = [];
  for (const o of original) {
    const mine = deler.filter((d) => d.farge === o.farge && d.strek === o.strek && d.fyll === o.fyll &&
      d.bredde === o.bredde && d.segs.every((s: any) => (o.segs as any[]).includes(s)));
    if (!mine.length) continue;
    const segs = (o.segs as any[]).filter((s) => mine.some((m) => (m.segs as any[]).includes(s)));
    ut.push({ ...o, segs, boks: {
      x0: Math.min(...mine.map((m) => m.boks.x0)), y0: Math.min(...mine.map((m) => m.boks.y0)),
      x1: Math.max(...mine.map((m) => m.boks.x1)), y1: Math.max(...mine.map((m) => m.boks.y1)) } } as Bane);
  }
  return ut;
}

/** passmerkets bredde og hvor langt det gaar inn under nabo-elementet, i ekte mm */
const PASS_BREDDE_MM = 10;
const PASS_OVERLAPP_MM = 5;

/**
 * Passmerke mellom to elementer som hoerer sammen.
 *
 * Eirik 16.11.2026, 309916 e-expert: XL-boksen og PROFF er ett merke paa
 * bilen, men skjaeres hver for seg for aa spare folie. Montoeren maa da
 * maale inn PROFF i forhold til XL-boksen. Med et passmerke slipper han
 * det: en strimmel i samme folie som henger med XL-boksen og gaar 5 mm inn
 * under P. Montoeren legger P der strimmelen viser, og river strimmelen av.
 *
 * Motoren trenger ikke vite at de er ett merke. Den ser fra skissen at de
 * staar i samme visning, side om side med lite luft imellom, i omtrent
 * samme hoeyde, og har en farge felles. Det er kjennetegnet paa noe som
 * er delt for aa spare folie.
 *
 * Strimmelen er loddrett (Eirik 16.11): den staar ved naboens naermeste
 * kant, i naboens fulle hoyde, PASS_OVERLAPP_MM inn under naboen og like
 * mye utenfor, i den felles fargen. Baereren er det
 * hoeyeste elementet, som monteres foerst. Elementer som telles i flere
 * eksemplarer faar ikke passmerke, siden naboen bare staar ved ett av dem.
 */
/**
 * Passmerke for tekst som er skilt ut fra en printet logo (Eirik 17.11.2026,
 * LTS Maskin: «den beine streken gir ikke god nok referanse til den hvite
 * teksten. dette er ikke idiotsikkert»). Logoen faar med TEKST_STUBB_MM av
 * foerste og siste hoeye tegn i teksten (D og ! i «Din innovative ...!»),
 * fra kanten som vender mot logoen. Montoeren legger teksten saa de to
 * tegnene dekker stubbene. Hoeye tegn er de som er minst 90 prosent av det
 * hoeyeste; i en tekst med smaa bokstaver blir det de med stamme (d, l, i).
 */
async function leggTekstPassmerker(elementer: BilElement[], baner: Map<BilElement, Bane[]>,
                                   malestokk: number, logg: string[], utskilt: Set<string>) {
  const boks = (bs: Bane[]) => ({
    x0: Math.min(...bs.map((b) => b.boks.x0)), y0: Math.min(...bs.map((b) => b.boks.y0)),
    x1: Math.max(...bs.map((b) => b.boks.x1)), y1: Math.max(...bs.map((b) => b.boks.y1)) });
  const stubb = (TEKST_STUBB_MM / malestokk) * MM;
  const nyeBaner = new Map<BilElement, Bane[]>();
  for (const t of elementer) {
    if (![...utskilt].some((n) => t.navn.includes(n)) || t.farger.length !== 1) continue;
    const bt = baner.get(t);
    if (!bt?.length) continue;
    const rt = boks(bt);
    // logoen i samme visning, flerfarget og naermest
    let logo: BilElement | null = null, best = Infinity;
    for (const l of elementer) {
      if (l === t || l.vis !== t.vis || l.farger.length < 2) continue;
      const bl = baner.get(l); if (!bl?.length) continue;
      const rl = boks(bl);
      const dx = Math.max(0, rl.x0 - rt.x1, rt.x0 - rl.x1), dy = Math.max(0, rl.y0 - rt.y1, rt.y0 - rl.y1);
      const d = Math.hypot(dx, dy);
      if (d < best) { best = d; logo = l; }
    }
    if (!logo) continue;
    const hex = t.farger[0].hex;
    if (!logo.farger.some((f) => f.hex === hex)) continue;   // da ville logoen faatt en ny farge
    const rl = boks(baner.get(logo)!);
    // retning: teksten under/over logoen (vannrett tekst) eller ved siden av (loddrett, toppvisning)
    const under = rt.y1 <= rl.y0 + 1e-6, over = rt.y0 >= rl.y1 - 1e-6;
    const vannrett = under || over;
    const komp: { f: any; b: { x0: number; y0: number; x1: number; y1: number } }[] = [];
    for (const b of bt) {
      const f = flateAvSegs(b.segs as any[]);
      if (!f) continue;
      for (const poly of f) {
        const pk = poly[0] as [number, number][];
        komp.push({ f: [poly], b: { x0: Math.min(...pk.map((q) => q[0])), y0: Math.min(...pk.map((q) => q[1])),
          x1: Math.max(...pk.map((q) => q[0])), y1: Math.max(...pk.map((q) => q[1])) } });
      }
    }
    if (komp.length < 2) continue;
    const hoyde = (k: typeof komp[number]) => vannrett ? k.b.y1 - k.b.y0 : k.b.x1 - k.b.x0;
    const maks = Math.max(...komp.map(hoyde));
    /**
     * Hoeye tegn er de med stamme opp fra grunnlinjen: D, l, k, d og !. En g
     * med underlengde er like hoey som en D, men gaar under grunnlinjen, og
     * stubben ble en bue (Eirik 17.11.2026). Grunnlinjen er den siden flest
     * tegn flukter mot; teksten kan staa paa hoykant begge veier.
     */
    // flere linjer: bare linja naermest logoen (kontaktteksten bak paa LTS)
    {
      const venstre0 = !vannrett && rt.x1 <= rl.x0 + 1e-6;
      const naer = (k: typeof komp[number]) => vannrett
        ? (under ? rt.y1 - k.b.y1 : k.b.y0 - rt.y0)
        : (venstre0 ? rt.x1 - k.b.x1 : k.b.x0 - rt.x0);
      const linja = komp.filter((k) => naer(k) <= 0.6 * maks);
      if (linja.length >= 2) komp.splice(0, komp.length, ...linja);
    }
    const lav = (k: typeof komp[number]) => vannrett ? k.b.y0 : k.b.x0;
    const hoy = (k: typeof komp[number]) => vannrett ? k.b.y1 : k.b.x1;
    /*
     * Grunnlinjen er en rett linje, ikke et tall: teksten kan staa litt
     * skraatt (toppvisningen paa LTS heller 0,7°). Den tilpasses med minste
     * kvadrater paa den siden flest tegn flukter mot, to runder med bare
     * tegnene som ligger paa den.
     */
    const langs = (k: typeof komp[number]) => vannrett ? (k.b.x0 + k.b.x1) / 2 : (k.b.y0 + k.b.y1) / 2;
    const tol = 0.08 * maks;
    const tilpass = (kant: (k: typeof komp[number]) => number) => {
      let bruk = komp.slice(), a = 0, b = 0;
      for (let runde = 0; runde < 3; runde++) {
        const n = bruk.length, su = bruk.reduce((s2, k) => s2 + langs(k), 0) / n, sv = bruk.reduce((s2, k) => s2 + kant(k), 0) / n;
        let num = 0, den = 0;
        for (const k of bruk) { num += (langs(k) - su) * (kant(k) - sv); den += (langs(k) - su) ** 2; }
        a = den > 0 ? num / den : 0; b = sv - a * su;
        const rest = komp.map((k) => Math.abs(kant(k) - (a * langs(k) + b)));
        const grense = Math.max(tol, rest.slice().sort((x, y) => x - y)[Math.floor(rest.length / 2)] * 1.5);
        const ny = komp.filter((_, i) => rest[i] < grense);
        if (ny.length < 2) break;
        bruk = ny;
      }
      const paa = komp.filter((k) => Math.abs(kant(k) - (a * langs(k) + b)) < tol);
      return { a, b, n: paa.length };
    };
    const fLav = tilpass(lav), fHoy = tilpass(hoy);
    const baseLav = fLav.n >= fHoy.n;
    const f = baseLav ? fLav : fHoy;
    const linje = (k: typeof komp[number]) => f.a * langs(k) + f.b;
    const paaBase = (k: typeof komp[number]) => Math.abs((baseLav ? lav(k) : hoy(k)) - linje(k)) < tol;
    const opp = (k: typeof komp[number]) => baseLav ? hoy(k) - linje(k) : linje(k) - lav(k);
    const toppOpp = Math.max(...komp.filter(paaBase).map(opp));
    const venstreLogo = !vannrett && rt.x1 <= rl.x0 + 1e-6;
    // ikke under grunnlinjen (underlengde), men gjerne over den: streken i
    // et utropstegn staar paa prikken, ikke paa linja
    const overBase = (k: typeof komp[number]) => (baseLav ? linje(k) - lav(k) : hoy(k) - linje(k)) < tol;
    // prikken over i-en naar ogsaa opp, men er ikke et tegn med stamme
    const hoye = komp.filter((k) => hoyde(k) >= 0.5 * maks && overBase(k) && opp(k) >= toppOpp - 0.15 * maks).sort((a, b) => vannrett ? a.b.x0 - b.b.x0 : b.b.y1 - a.b.y1);
    /**
     * Stubben skal vaere ett solid stykke montoeren kan se og strippe
     * (Eirik 17.11.2026: «å lage de mikroskopiske bitene der er ris til egen
     * ræv»). Et baand gjennom en buet bokstav gir buer og smaa linser.
     * Biter under STUBB_MIN_ANDEL av den stoerste, eller tynnere enn
     * STUBB_MIN_MM, tas ikke med. Gir tegnet ingen solid stubb, proeves
     * neste hoeye tegn innover.
     */
    const minTykk = (STUBB_MIN_MM / malestokk) * MM;
    const lagStubb = (k: typeof komp[number]): { del: any; god: boolean } | null => {
      let r: number[];
      if (vannrett) r = under ? [k.b.x0 - 1, k.b.y1 - stubb, k.b.x1 + 1, k.b.y1 + 1] : [k.b.x0 - 1, k.b.y0 - 1, k.b.x1 + 1, k.b.y0 + stubb];
      else r = rt.x1 <= rl.x0 + 1e-6 ? [k.b.x1 - stubb, k.b.y0 - 1, k.b.x1 + 1, k.b.y1 + 1] : [k.b.x0 - 1, k.b.y0 - 1, k.b.x0 + stubb, k.b.y1 + 1];
      let del: any;
      try { del = pc.intersection(k.f, [[[r[0], r[1]], [r[2], r[1]], [r[2], r[3]], [r[0], r[3]], [r[0], r[1]]]]); } catch { return null; }
      if (!del?.length) return null;
      const arealer = del.map((p: any) => arealKlipp([p]));
      const maksA = Math.max(...arealer);
      const solid = (p: any) => { try { return arealKlipp(utvidKlipp([p], -minTykk / 2)) > 0; } catch { return true; } };
      const beholdt = del.filter((p: any, i: number) => arealer[i] >= STUBB_MIN_ANDEL * maksA && solid(p));
      if (!beholdt.length) return null;
      const tot = arealer.reduce((a: number, b: number) => a + b, 0);
      return { del: beholdt, god: beholdt.length === 1 && maksA >= 0.85 * tot };
    };
    // ytterst i teksten: jo lenger fra hverandre, jo mindre gir en skjev
    // montering utslag (Eirik 17.11.2026). Bare tegn uten solid stubb hoppes over.
    const velgFra = (liste: typeof komp) => {
      for (const k of liste.slice(0, 4)) { const st = lagStubb(k); if (st) return st; }
      return null;
    };
    const valgt = hoye.length > 1 ? [velgFra(hoye), velgFra(hoye.slice().reverse())] : [velgFra(hoye)];
    const stubber: Bane[] = [];
    for (const st of valgt) {
      if (!st) continue;
      const del = st.del;
      const segs: any[] = [];
      for (const poly of del) for (const ring of poly) {
        segs.push({ t: "m", p: ring[0] });
        for (let i = 1; i < ring.length - 1; i++) segs.push({ t: "l", p: ring[i] });
        segs.push({ t: "h" });
      }
      const pts = segs.filter((x) => x.p).map((x) => x.p as number[]);
      const kilde = bt.find((x) => x.fyll) ?? bt[0];
      stubber.push({ segs, farge: kilde.farge.slice(), strekFarge: kilde.farge.slice(), fyll: true, strek: false, bredde: 0,
        boks: { x0: Math.min(...pts.map((p) => p[0])), y0: Math.min(...pts.map((p) => p[1])),
          x1: Math.max(...pts.map((p) => p[0])), y1: Math.max(...pts.map((p) => p[1])) } } as Bane);
    }
    if (!stubber.length) continue;
    nyeBaner.set(logo, [...(nyeBaner.get(logo) ?? baner.get(logo)!), ...stubber]);
    logo.passmerke = { mot: t.navn, hex, lengdeMm: TEKST_STUBB_MM };
    logg.push(`${logo.navn}: passmerke for ${t.navn}: ${TEKST_STUBB_MM} mm av foerste og siste hoeye tegn i teksten ` +
      "ligger med i logoen. Montoeren legger teksten saa tegnene dekker stubbene.");
  }
  for (const [l, bs] of nyeBaner) { baner.set(l, bs); l.pdf = await skrivPdf(bs); }
}

async function leggPassmerker(elementer: BilElement[], baner: Map<BilElement, Bane[]>,
                              malestokk: number, merknader: string[], utskilt: Set<string> = new Set()) {
  const boks = (bs: Bane[]) => ({
    x0: Math.min(...bs.map((b) => b.boks.x0)), y0: Math.min(...bs.map((b) => b.boks.y0)),
    x1: Math.max(...bs.map((b) => b.boks.x1)), y1: Math.max(...bs.map((b) => b.boks.y1)) });
  const tilTegnet = (mm: number) => (mm / malestokk) * MM;
  const brukt = new Set<BilElement>();
  for (const a of elementer) for (const b of elementer) {
    if (a === b || a.vis !== b.vis || brukt.has(a) || brukt.has(b)) continue;
    if (a.antall !== 1 || b.antall !== 1 || a.sammeSom || b.sammeSom) continue;
    const ba = baner.get(a), bb = baner.get(b);
    if (!ba || !bb) continue;
    const ra = boks(ba), rb = boks(bb);
    // utskilt tekst faar passmerke bare mot logoen den ble skilt fra (flerfarget)
    const erUtskilt = (e: BilElement) => [...utskilt].some((n) => e.navn.includes(n));
    // utskilt tekst faar bokstav-passmerke i leggTekstPassmerker, ikke strimmel
    if (erUtskilt(a) || erUtskilt(b)) continue;
    /**
     * Side om side (XL-boksen og PROFF): loddrett strimmel ved naboens kant,
     * i naboens hoeyde. Over og under hverandre (Eirik 16.11.2026, LTS
     * Maskin: den hvite teksten under den printede logoen): vannrett
     * strimmel ved naboens kant, i naboens bredde.
     */
    const ha = ra.y1 - ra.y0, hb = rb.y1 - rb.y0, wa = ra.x1 - ra.x0, wb = rb.x1 - rb.x0;
    let side = false, stablet = false;
    if (rb.x0 > ra.x1) {
      const luft = rb.x0 - ra.x1, overlappY = Math.min(ra.y1, rb.y1) - Math.max(ra.y0, rb.y0);
      side = luft <= 0.5 * Math.min(ha, hb) && overlappY >= 0.5 * Math.min(ha, hb) && Math.max(ha, hb) <= 2 * Math.min(ha, hb);
    } else if (rb.y0 > ra.y1 && (erUtskilt(a) || erUtskilt(b))) {
      const luft = rb.y0 - ra.y1, overlappX = Math.min(ra.x1, rb.x1) - Math.max(ra.x0, rb.x0);
      stablet = luft <= Math.max(ha, hb) && overlappX >= 0.5 * Math.min(wa, wb);
    }
    if (!side && !stablet) continue;
    const felles = a.farger.map((f) => f.hex).filter((h) => b.farger.some((g) => g.hex === h));
    if (!felles.length) continue;
    // morkeste felles farge: den ses best og er oftest naboens farge
    const lum = (h: string) => parseInt(h.slice(1, 3), 16) + parseInt(h.slice(3, 5), 16) + parseInt(h.slice(5, 7), 16);
    const hex = felles.sort((x, y) => lum(x) - lum(y))[0];
    const stor = side ? ha >= hb : wa * ha >= wb * hb;
    const [baerer, nabo] = stor ? [a, b] : [b, a];
    const [rB, rN] = stor ? [ra, rb] : [rb, ra];
    const kilde = (baner.get(nabo) ?? []).find((x) => x.fyll && baneHex(x.farge) === hex)
      ?? (baner.get(baerer) ?? []).find((x) => x.fyll && baneHex(x.farge) === hex);
    if (!kilde) continue;
    // PASS_OVERLAPP_MM inn under naboen og like mye utenfor, saa den kan
    // gripes og rives av (Eirik 16.11: loddrett ved side om side).
    const inn = tilTegnet(PASS_OVERLAPP_MM), ut = tilTegnet(PASS_BREDDE_MM - PASS_OVERLAPP_MM);
    let x0: number, x1: number, y0: number, y1: number;
    if (side) {
      y0 = rN.y0; y1 = rN.y1;
      [x0, x1] = rN.x0 > rB.x1 ? [rN.x0 - ut, rN.x0 + inn] : [rN.x1 - inn, rN.x1 + ut];
    } else {
      x0 = rN.x0; x1 = rN.x1;
      [y0, y1] = rN.y0 > rB.y1 ? [rN.y0 - ut, rN.y0 + inn] : [rN.y1 - inn, rN.y1 + ut];
    }
    const strimmel: Bane = {
      segs: [{ t: "m", p: [x0, y0] }, { t: "l", p: [x1, y0] }, { t: "l", p: [x1, y1] },
             { t: "l", p: [x0, y1] }, { t: "h" }] as any,
      farge: kilde.farge.slice(), strekFarge: kilde.farge.slice(),
      fyll: true, strek: false, bredde: 0,
      boks: { x0, y0, x1, y1 },
    };
    const nye = [...(baner.get(baerer) ?? []), strimmel];
    baerer.pdf = await skrivPdf(nye);
    const per = await hentGeometriPerFarge(baerer.pdf, 1.0);
    baerer.breddeMm = Math.round(((per.bbox[2] - per.bbox[0]) / MM) * malestokk);
    baerer.hoydeMm = Math.round(((per.bbox[3] - per.bbox[1]) / MM) * malestokk);
    baerer.farger = per.lag.map((l) => ({ hex: l.hex, andel: l.andel }));
    baerer.passmerke = { mot: nabo.navn, hex, lengdeMm: Math.round(((side ? y1 - y0 : x1 - x0) / MM) * malestokk) };
    baner.set(baerer, nye);
    brukt.add(a); brukt.add(b);
    merknader.push(`${baerer.navn}: passmerke lagt inn mot ${nabo.navn}, en ${side ? "loddrett" : "vannrett"} strimmel ` +
      `${PASS_BREDDE_MM} mm bred i ${hex} ved naboens kant og i naboens ${side ? "hoyde" : "bredde"}, ${PASS_OVERLAPP_MM} mm ` +
      "inn under den. Montoeren legger naboen der strimmelen viser, og river strimmelen av.");
  }
}

/**
 * Levende tekst i en visning.
 *
 * Motoren leser bare baner. Tekst som ikke er konvertert til kurver har
 * ingen baner og blir derfor ikke med, uten at noe ellers sier fra. Paa
 * 309916 e-expert manglet «XL-BYGG Osteroy» og telefonnummeret paa to av
 * tre steder: pinnen kom med, teksten ved siden av ikke. Det er det samme
 * som aa fjerne noe fra logoen, og det skal aldri skje i stillhet.
 *
 * Tekst ved et dekorelement knyttes til det. Annen tekst i en visning
 * meldes ogsaa, for den kan vaere dekor uten noe annet rundt seg. Tekst
 * utenfor visningene er arkinformasjon, og usynlig tekst (Tr 3) er ikke
 * tegnet. Tekst i skissens egne farger er maalpiler og merker.
 */
type BoksT = { x0: number; y0: number; x1: number; y1: number };
const inniBoks = (b: BoksT, o: BoksT, pad = 0) =>
  (b.x0 + b.x1) / 2 >= o.x0 - pad && (b.x0 + b.x1) / 2 <= o.x1 + pad &&
  (b.y0 + b.y1) / 2 >= o.y0 - pad && (b.y0 + b.y1) / 2 <= o.y1 + pad;
/**
 * Tekst som hoerer til visningene: synlig, inne i en visning, og ikke i
 * skissens egne farger (maalpiler og merker). Det er den som meldes som
 * levende tekst, og den som gjoeres om til kurver.
 */
function tekstIVisning(t: BoksT & { usynlig: boolean; farge?: number[] }, funn: ReturnType<typeof finnDekor>, pad = 0): boolean {
  const egne = new Set(BILFARGER);
  const fn = (f?: number[]) => (f ?? []).map((x) => x.toFixed(2)).join(",");
  return !t.usynlig && !egne.has(fn(t.farge)) && funn.visninger.some((v) => inniBoks(t, v, pad));
}

function finnLevendeTekst(levende: TekstBoks[], funn: ReturnType<typeof finnDekor>, malestokk: number) {
  const NAER = 3 * MM;
  const inni = inniBoks;
  const aktuelle = levende.filter((t) => tekstIVisning(t, funn));
  // samle bokstaver til linjer: samme grunnlinje og tett paa hverandre
  const linjer: TekstBoks[][] = [];
  for (const t of [...aktuelle].sort((a, b) => b.y0 - a.y0 || a.x0 - b.x0)) {
    const l = linjer.find((g) => {
      const s = g[g.length - 1];
      return Math.abs(s.y0 - t.y0) < 0.5 && t.x0 - s.x1 < (s.y1 - s.y0) * 1.5;
    });
    if (l) l.push(t); else linjer.push([t]);
  }
  void malestokk;
  return linjer.map((g) => {
    const r = { x0: Math.min(...g.map((t) => t.x0)), y0: Math.min(...g.map((t) => t.y0)),
                x1: Math.max(...g.map((t) => t.x1)), y1: Math.max(...g.map((t) => t.y1)) };
    const midt = { ...g[0], ...r };
    const avstand = (oo: { x0: number; y0: number; x1: number; y1: number }) => Math.hypot(
      Math.max(0, oo.x0 - r.x1, r.x0 - oo.x1), Math.max(0, oo.y0 - r.y1, r.y0 - oo.y1));
    const o = funn.omraader.find((oo) => avstand(oo) <= NAER);
    const v = funn.visninger.find((vv) => inni(midt, vv));
    return { tekst: g.map((t) => t.tekst).join("").replace(/\s+/g, " ").trim(),
             vis: v?.navn ?? "ukjent", element: o ? `${o.vis} ${o.navn}` : null };
  });
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
