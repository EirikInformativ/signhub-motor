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
import type { TekstBoks } from "./bilskisse.ts";
import { finnDekor, BILFARGER } from "./dekorfinn.ts";
import { hentBaner, skrivPdf } from "./uttrekk.ts";
import type { Bane } from "./uttrekk.ts";
import { hentGeometriPerFarge, areal, cmykTilRgb, tilHex } from "./pdfbaner.ts";
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

export async function lesBilskisse(kilde: Uint8Array, v: BilValg): Promise<BilSkisseLest> {
  const lett = await lesLett(kilde);
  const s = tolk(lett);
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
  const funn = finnDekor(lett, malestokk, { L: s.lengdeM, B: s.breddeM, H: s.hoydeM });
  const merknader = [...s.merknader, ...funn.merknader];
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
    const likBoks = (b: Bane) => o.liste.some((x) => Math.abs(x.x0 - b.boks.x0) < T &&
      Math.abs(x.y0 - b.boks.y0) < T && Math.abs(x.x1 - b.boks.x1) < T && Math.abs(x.y1 - b.boks.y1) < T);
    const valgte = baner.filter((b) => !b.gradient && andel(b, o) >= 0.9 && !erBil(b) && likBoks(b));
    if (!valgte.length) continue;
    const deler = samleDeler(valgte, (DEL_FIN_MM / malestokk) * MM, (DEL_GLIPPE_MM / malestokk) * MM);
    if (deler.length === 1) { arbeid.push({ o, valgte }); continue; }
    deler.forEach((d, k) => arbeid.push({ o: { ...o, navn: `${o.navn} del ${k + 1}` }, valgte: d }));
    merknader.push(`${o.vis} ${o.navn}: delt i ${deler.length} deler som skjaeres hver for seg ` +
      "(tekst og striper som bare staar ved siden av hverandre).");
  }
  for (const { o, valgte: raa } of arbeid) {
    const rett = rettOpp(raa);
    const valgte = rett.baner;
    if (rett.vinkel) merknader.push(`${o.vis} ${o.navn}: rettet opp ${Math.abs(rett.vinkel).toFixed(1).replace(".", ",")}° i ` +
      `produksjonsfila (sparer ${rett.spartProsent.toFixed(0)} % ramme). Monteres med samme helning som paa skissen.`);
    // ogsaa her skal en feil si hvilket element den gjelder, ikke bare hvilken farge
    const lesTrygt = async (bytes: Uint8Array) => {
      try {
        return await hentGeometriPerFarge(bytes, 1.0);
      } catch (e: any) {
        throw new Error(`${o.vis} ${o.navn}: ${String(e?.message ?? e ?? "ukjent feil")}`);
      }
    };
    let pdf = await skrivPdf(valgte);
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
    if (plateform && bunnhex !== lakkHex) merknader.push(
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
        pdf = await skrivPdf(igjen);
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
        merknader.push(
          `${o.vis} ${o.navn}: bakgrunnsplaten ${platehex} ` +
          `(${(plate.andel * 100).toFixed(1)} % av motivet) er tatt ut, ` +
          "bade av fargelista og av filen. Den er ikke dekor, den er " +
          "mellomrommet, og skjaeres ikke.");
      }
    }

    const nytt: BilElement = {
      id: nokkel, vis: o.vis, navn: `${o.vis} ${o.navn}`, pdf,
      breddeMm: Math.round(tegnetB * malestokk),
      hoydeMm: Math.round(tegnetH * malestokk),
      antall: 1,
      farger: per.lag.map((l) => ({ hex: l.hex, andel: l.andel })),
      ...(bakgrunn ? { bakgrunn } : {}),
    };
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
   * Motoren fjerner det ikke selv. Den peker ut det minste som trolig samme
   * som det stoerste og sier fra, saa et menneske tar det ut.
   */
  for (const a of elementer) for (const b of elementer) {
    if (a === b || a.vis === b.vis || a.sammeSom || b.sammeSom) continue;
    if (a.farger.length !== b.farger.length) continue;
    const likFarge = a.farger.every((f) => {
      const g = b.farger.find((x) => x.hex === f.hex);
      return g && Math.abs(g.andel - f.andel) < 0.015;
    });
    const la = Math.max(a.breddeMm, a.hoydeMm), lb = Math.max(b.breddeMm, b.hoydeMm);
    const ka = Math.min(a.breddeMm, a.hoydeMm), kb = Math.min(b.breddeMm, b.hoydeMm);
    if (!likFarge || Math.abs(la - lb) / Math.max(la, lb) > 0.02 || ka >= kb * 0.8) continue;
    a.sammeSom = b.navn;
    merknader.push(`${a.navn} (${a.breddeMm} x ${a.hoydeMm} mm) ser ut til a vaere samme merke som ` +
      `${b.navn} (${b.breddeMm} x ${b.hoydeMm} mm), sett fra en annen vinkel. ` +
      "Ta det ut av jobben hvis det stemmer, ellers skjaeres det to ganger.");
  }

  await leggPassmerker(elementer, brukteBaner, malestokk, merknader);

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
    elementer, forside, merknader, levendeTekst,
  };
}


/** En bane delt i delbaner, en per «m», med egen ramme. */
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
export function delIDeler(baner: Bane[], glippe: number): Bane[][] {
  const d = baner.flatMap(delbaner);
  const p = d.map((_, i) => i);
  const f = (i: number): number => (p[i] === i ? i : (p[i] = f(p[i])));
  const av = (a: Bane["boks"], b: Bane["boks"]) => Math.hypot(
    Math.max(0, a.x0 - b.x1, b.x0 - a.x1), Math.max(0, a.y0 - b.y1, b.y0 - a.y1));
  for (let i = 0; i < d.length; i++)
    for (let j = i + 1; j < d.length; j++)
      if (av(d[i].boks, d[j].boks) <= glippe) p[f(i)] = f(j);
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
function rettOpp(baner: Bane[]): { baner: Bane[]; vinkel: number; spartProsent: number } {
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
        if (len > 0 && Math.abs(g) <= RETT_MAKS_GRAD) {
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
  const best = sw > 0 && modeV >= 0.05 * bredde ? -sv / sw : 0;
  const bestA = flate(best);
  const gevinst = 1 - bestA / Math.max(null0, 1e-9);
  // grunnlinjen avgjoer; gevinsten i ramme meldes bare
  if (Math.abs(best) < RETT_MIN_GRAD) return { baner, vinkel: 0, spartProsent: 0 };
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
  return { baner: ut, vinkel: best, spartProsent: gevinst * 100 };
}

/** delene innenfor denne avstanden (ekte mm) kan hoere sammen */
const DEL_GLIPPE_MM = 50;
/** under denne avstanden er det samme del (bokstav og hull, ring og A) */
const DEL_FIN_MM = 10;
/** felles ramme over dette ganger delenes egne rammer: for mye luft */
const DEL_LUFT = 2;

function samleDeler(baner: Bane[], fin: number, glippe: number): Bane[][] {
  let g = delIDeler(baner, fin);
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
      if (d > glippe) continue;
      const felles = ar(ramme([...g[i], ...g[j]]));
      if (felles > DEL_LUFT * (ar(ri) + ar(rj))) continue;
      if (!best || d < best[2]) best = [i, j, d];
    }
    if (!best) break;
    const [i, j] = best;
    // samme bane delt paa to deler blir en bane igjen
    const samlet = [...g[i], ...g[j]];
    g = g.filter((_, k) => k !== i && k !== j);
    g.push(slaaSammenBaner(samlet, baner));
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
async function leggPassmerker(elementer: BilElement[], baner: Map<BilElement, Bane[]>,
                              malestokk: number, merknader: string[]) {
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
    if (rb.x0 <= ra.x1) continue;                     // b skal staa til hoyre for a
    const ha = ra.y1 - ra.y0, hb = rb.y1 - rb.y0;
    const luft = rb.x0 - ra.x1;
    const overlappY = Math.min(ra.y1, rb.y1) - Math.max(ra.y0, rb.y0);
    if (luft > 0.5 * Math.min(ha, hb)) continue;       // for langt fra hverandre
    if (overlappY < 0.5 * Math.min(ha, hb)) continue;  // ikke i samme hoyde
    if (Math.max(ha, hb) > 2 * Math.min(ha, hb)) continue;
    const felles = a.farger.map((f) => f.hex).filter((h) => b.farger.some((g) => g.hex === h));
    if (!felles.length) continue;
    // morkeste felles farge: den ses best og er oftest naboens farge
    const lum = (h: string) => parseInt(h.slice(1, 3), 16) + parseInt(h.slice(3, 5), 16) + parseInt(h.slice(5, 7), 16);
    const hex = felles.sort((x, y) => lum(x) - lum(y))[0];
    const [baerer, nabo] = ha >= hb ? [a, b] : [b, a];
    const [rB, rN] = ha >= hb ? [ra, rb] : [rb, ra];
    const kilde = (baner.get(nabo) ?? []).find((x) => x.fyll && baneHex(x.farge) === hex)
      ?? (baner.get(baerer) ?? []).find((x) => x.fyll && baneHex(x.farge) === hex);
    if (!kilde) continue;
    // Loddrett strimmel ved naboens naermeste kant, i naboens fulle hoyde:
    // PASS_OVERLAPP_MM inn under naboen og like mye utenfor, saa den kan
    // gripes og rives av. Den viser baade hvor kanten skal staa og hvor
    // topp og bunn skal ligge (Eirik 16.11: loddrett, ikke vannrett).
    const inn = tilTegnet(PASS_OVERLAPP_MM), ut = tilTegnet(PASS_BREDDE_MM - PASS_OVERLAPP_MM);
    const y0 = rN.y0, y1 = rN.y1;
    const [x0, x1] = rN.x0 > rB.x1 ? [rN.x0 - ut, rN.x0 + inn] : [rN.x1 - inn, rN.x1 + ut];
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
    baerer.passmerke = { mot: nabo.navn, hex, lengdeMm: Math.round(((y1 - y0) / MM) * malestokk) };
    baner.set(baerer, nye);
    brukt.add(a); brukt.add(b);
    merknader.push(`${baerer.navn}: passmerke lagt inn mot ${nabo.navn}, en loddrett strimmel ` +
      `${PASS_BREDDE_MM} mm bred i ${hex} ved naboens kant og i naboens hoyde, ${PASS_OVERLAPP_MM} mm ` +
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
function finnLevendeTekst(levende: TekstBoks[], funn: ReturnType<typeof finnDekor>, malestokk: number) {
  const NAER = 3 * MM;
  const inni = (b: TekstBoks, o: { x0: number; y0: number; x1: number; y1: number }, pad = 0) =>
    (b.x0 + b.x1) / 2 >= o.x0 - pad && (b.x0 + b.x1) / 2 <= o.x1 + pad &&
    (b.y0 + b.y1) / 2 >= o.y0 - pad && (b.y0 + b.y1) / 2 <= o.y1 + pad;
  const egne = new Set(BILFARGER);
  const fn = (f?: number[]) => (f ?? []).map((x) => x.toFixed(2)).join(",");
  const aktuelle = levende.filter((t) => !t.usynlig && !egne.has(fn(t.farge)) &&
    funn.visninger.some((v) => inni(t, v)));
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
