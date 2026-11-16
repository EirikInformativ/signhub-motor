/**
 * Finner dekoren i en bilskisse uten at noen peker den ut.
 *
 * Reglene, i den rekkefolgen de virker:
 *
 *  1. Bilen er tegnet i gratoner. Alt som har kulor er en kandidat.
 *  2. Skissen har sine egne kulorer: malpiler, hjelpelinjer og lykter.
 *     De kjennes igjen ved at fargen ogsa brukes til harstrek, altsa en
 *     strek som er under 3 mm i virkeligheten og mer enn tretti ganger
 *     sa lang som den er bred. Ingen legger folie i den formen. En farge
 *     som opptrer slik, er skissens egen og ikke kundens.
 *  3. Det som ligger utenfor visningene er arkinformasjon, ikke dekor.
 *  4. Resten samles i klynger. En klynge er ett dekorelement.
 *  5. Hvite og svarte deler av logoen har ingen kulor, sa de fanges til
 *     slutt ved at de ligger inne i klyngens ramme.
 */
import type { Boks, LettLest } from "./bilskisse.ts";

const MM = 72 / 25.4;

const HARSTREK_MM = 0.1;      // tegnet tykkelse
const HARSTREK_FORHOLD = 30;
const KLYNGE_MM = 3;          // tegnet glippe innenfor ett element
const MINSTE_EKTE_MM = 30;    // mindre enn dette er ikke folie
const NABO_MM = 1;            // tegnet avstand der svart ved siden av hoerer til logoen

/** K 100 eller rik sort: designerens sort, ikke bilens K-graatoner */
const svart = (b: Boks) => !!b.farge && b.farge.length === 4 && (
  (Math.max(b.farge[0], b.farge[1], b.farge[2]) < 0.01 && b.farge[3] >= 0.99) ||
  (Math.min(b.farge[0], b.farge[1], b.farge[2]) > 0.4 && b.farge[3] > 0.5));

/**
 * Farger som tilhoerer selve bilen i CCVision-tegningene, uansett om de
 * ogsaa brukes til harstrek. Regel 2 fanger lyktefargen bare naar skissen
 * tilfeldigvis har en harstrek i samme farge. Proace-skissen har det,
 * e-expert-skissen (309916) har det ikke, og der ble baklykter, refleks,
 * hjul og hele taket lest som dekor. Lista er fasit, ikke gjetning: hver
 * farge staar her fordi en ekte skisse viste at den er bilens, og
 * test/bilfarger.ts vokter det.
 *
 *   0.00,1.00,1.00,0.15   lykter og refleks (CMYK)
 */
/** over denne andelen bilgraatt er klyngen en del av bilen */
const BILGRAA_ANDEL = 0.25;

/** Hvit flate paa moerk bil stoerre enn dette er dekor uansett tegnerekkefoelge. */
const STOR_LYS_MM = 300;
/** Kuloeren som dekker mer enn denne andelen av det fylte, er bilens lakk. */
const LAKK_ANDEL = 0.3;

export const BILFARGER = new Set<string>(["0.00,1.00,1.00,0.15"]);

export interface DekorOmraade {
  x0: number; y0: number; x1: number; y1: number;
  vis: string; navn: string;
  bokser: number;
  /** flatene som utgjoer elementet, saa bilmotor kan velge nettopp dem */
  liste: Boks[];
  farger: string[];
  breddeEkteMm: number; hoydeEkteMm: number;
  sikkerhet: "sikker" | "tvil";
}

export interface Visning {
  x0: number; y0: number; x1: number; y1: number;
  navn: string; breddeEkteMm: number; hoydeEkteMm: number;
}

export interface DekorFunn {
  visninger: Visning[];
  omraader: DekorOmraade[];
  forkastet: { hva: string; grunn: string }[];
  merknader: string[];
}

const ramme = (bs: Boks[]): Boks => ({
  x0: Math.min(...bs.map((b) => b.x0)), y0: Math.min(...bs.map((b) => b.y0)),
  x1: Math.max(...bs.map((b) => b.x1)), y1: Math.max(...bs.map((b) => b.y1)),
});

const kulor = (b: Boks) => !!b.farge && Math.max(b.farge[0], b.farge[1], b.farge[2]) >= 0.05;
const fargenavn = (b: Boks) => (b.farge ?? []).map((x) => x.toFixed(2)).join(",");

/** Klynger bokser som ligger naermere hverandre enn glippe. */
function klynger(bs: Boks[], glippe: number): Boks[][] {
  const p = bs.map((_, i) => i);
  const f = (i: number): number => (p[i] === i ? i : (p[i] = f(p[i])));
  const av = (a: Boks, b: Boks) => Math.hypot(
    Math.max(0, Math.max(a.x0 - b.x1, b.x0 - a.x1)),
    Math.max(0, Math.max(a.y0 - b.y1, b.y0 - a.y1)));
  for (let i = 0; i < bs.length; i++)
    for (let j = i + 1; j < bs.length; j++)
      if (av(bs[i], bs[j]) <= glippe) p[f(i)] = f(j);
  const m = new Map<number, Boks[]>();
  bs.forEach((b, i) => { const r = f(i); if (!m.has(r)) m.set(r, []); m.get(r)!.push(b); });
  return [...m.values()];
}

const andelInni = (b: Boks, o: Boks) => {
  const ox = Math.max(0, Math.min(b.x1, o.x1) - Math.max(b.x0, o.x0));
  const oy = Math.max(0, Math.min(b.y1, o.y1) - Math.max(b.y0, o.y0));
  return (ox * oy) / Math.max((b.x1 - b.x0) * (b.y1 - b.y0), 1e-9);
};

/** Visningene pa arket, navngitt ved hjelp av malene i teksten. */
/**
 * Visninger ligger i rader og kolonner med hvitt imellom. Vi leter etter
 * det hvite: rader uten blekk deler arket i band, kolonner uten blekk
 * deler et band i visninger. Det er sikrere enn a male avstand mellom
 * bokser, for en enkelt bokelig ramme kan spenne over mye tomrom.
 */
function profilDel(bokser: Boks[], vannrett: boolean, glippe: number): Boks[][] {
  if (!bokser.length) return [];
  const lo = Math.min(...bokser.map((b) => (vannrett ? b.y0 : b.x0)));
  const hi = Math.max(...bokser.map((b) => (vannrett ? b.y1 : b.x1)));
  const n = Math.max(1, Math.ceil((hi - lo) / glippe));
  const blekk = new Uint8Array(n + 1);
  for (const b of bokser) {
    const a = Math.floor(((vannrett ? b.y0 : b.x0) - lo) / glippe);
    const z = Math.ceil(((vannrett ? b.y1 : b.x1) - lo) / glippe);
    for (let i = Math.max(0, a); i <= Math.min(n, z); i++) blekk[i] = 1;
  }
  const kant: [number, number][] = [];
  let start = -1;
  for (let i = 0; i <= n; i++) {
    if (blekk[i] && start < 0) start = i;
    else if (!blekk[i] && start >= 0) { kant.push([lo + start * glippe, lo + i * glippe]); start = -1; }
  }
  if (start >= 0) kant.push([lo + start * glippe, hi]);
  return kant.map(([a, z]) => bokser.filter((b) => {
    const m = vannrett ? (b.y0 + b.y1) / 2 : (b.x0 + b.x1) / 2;
    return m >= a && m <= z;
  })).filter((g) => g.length);
}

export function finnVisninger(bokser: Boks[], malestokk: number,
                              dim: { L: number | null; B: number | null; H: number | null }): Visning[] {
  const grupper = profilDel(bokser, true, 2 * MM)
    .flatMap((band) => profilDel(band, false, 2 * MM))
    .map((g) => ramme(g))
    .filter((r) => (r.x1 - r.x0) / MM > 20 && (r.y1 - r.y0) / MM > 20)
    .sort((a, b) => b.y1 - a.y1);

  const naer = (x: number, y: number) => Math.abs(x / y - 1) <= 0.3;
  const rader: Visning[] = grupper.map((r) => ({
    ...r, navn: "visning",
    breddeEkteMm: ((r.x1 - r.x0) / MM) * malestokk,
    hoydeEkteMm: ((r.y1 - r.y0) / MM) * malestokk,
  }));

  /**
   * En skisse har tre visninger pa langs (topp og to sider) og to i enden.
   * Topp og side er like lange, sa lengden skiller dem ikke. Men de to
   * sidene er like hoye, og toppen er den som blir til overs. Det er
   * sikrere enn a sammenligne med bredde og hoyde, for pa en varebil er
   * bredden og hoyden nesten like store.
   */
  const langs = dim.L ? rader.filter((v) => naer(v.breddeEkteMm / 1000, dim.L!)) : [];
  const ender = rader.filter((v) => !langs.includes(v));

  if (langs.length >= 3) {
    let beste: [Visning, Visning] | null = null, minst = Infinity;
    for (let i = 0; i < langs.length; i++) for (let j = i + 1; j < langs.length; j++) {
      const d = Math.abs(langs[i].hoydeEkteMm - langs[j].hoydeEkteMm);
      if (d < minst) { minst = d; beste = [langs[i], langs[j]]; }
    }
    const sider = (beste ?? []).slice().sort((x, y) => y.y1 - x.y1);
    sider.forEach((v, i) => { v.navn = i === 0 ? "side ovre" : "side nedre"; });
    for (const v of langs) if (!sider.includes(v)) v.navn = "topp";
  } else {
    for (const v of langs) {
      v.navn = dim.B && dim.H
        ? (Math.abs(v.hoydeEkteMm / 1000 - dim.B) < Math.abs(v.hoydeEkteMm / 1000 - dim.H) ? "topp" : "side")
        : "langs";
    }
  }
  const sortert = ender.slice().sort((x, y) => x.x0 - y.x0);
  sortert.forEach((v, i) => {
    v.navn = sortert.length === 2 ? (i === 0 ? "ende venstre" : "ende hoyre") : `ende ${i + 1}`;
  });

  // nummerer eventuelle gjengangere slik at navnene er entydige
  const teller = new Map<string, number>(), antall = new Map<string, number>();
  for (const v of rader) antall.set(v.navn, (antall.get(v.navn) ?? 0) + 1);
  for (const v of rader) {
    if ((antall.get(v.navn) ?? 0) < 2) continue;
    const n = (teller.get(v.navn) ?? 0) + 1;
    teller.set(v.navn, n);
    v.navn = `${v.navn} ${n}`;
  }
  return rader;
}

export function finnDekor(lest0: LettLest, malestokk: number,
                          dim: { L: number | null; B: number | null; H: number | null }): DekorFunn {
  const merknader: string[] = [];
  /**
   * Innsatte bilder (foto) er ikke baner og kan ikke skjaeres. De holdes
   * utenfor dekoren og meldes, saa et foto paa bilen aldri forsvinner i
   * stillhet (Vito 304160: generatorbildet paa sidene).
   */
  const bilder = lest0.bokser.filter((b) => b.bilde);
  const lest: LettLest = { ...lest0, bokser: lest0.bokser.filter((b) => !b.bilde) };
  const forkastet: { hva: string; grunn: string }[] = [];

  /**
   * Lakkert bil i kuloer (Eirik 16.11.2026, Vito 304160 i moerkeblaa): den
   * kuloerte fargen som dekker mest, og mer enn LAKK_ANDEL av alt som er
   * fylt, er bilens lakk, ikke dekor. Den behandles som bilens egne farger,
   * og er den moerk, er bilen moerk (hvitt er dekor).
   */
  const sideA0 = (lest.side.x1 - lest.side.x0) * (lest.side.y1 - lest.side.y0);
  const flateA = (b: Boks) => (b.x1 - b.x0) * (b.y1 - b.y0);
  const smaa = lest.bokser.filter((b) => flateA(b) < 0.25 * sideA0);
  const perFarge = new Map<string, number>();
  for (const b of smaa) if (kulor(b)) perFarge.set(fargenavn(b), (perFarge.get(fargenavn(b)) ?? 0) + flateA(b));
  const totalt = smaa.reduce((a, b) => a + flateA(b), 0);
  const [lakkNavn, lakkA] = [...perFarge].sort((a, b) => b[1] - a[1])[0] ?? ["", 0];
  const lakk = lakkA > LAKK_ANDEL * totalt ? lakkNavn : "";
  const erLakk = (b: Boks) => !!lakk && fargenavn(b) === lakk;
  const lakkMoerk = (() => {
    if (!lakk) return null;
    const [c, m, y, k] = lakk.split(",").map(Number);
    const lum = 0.3 * (1 - c) * (1 - k) + 0.59 * (1 - m) * (1 - k) + 0.11 * (1 - y) * (1 - k);
    return lum < 0.5;
  })();
  if (lakk) merknader.push(`Bilen er lakkert i ${lakk} (CMYK). Den fargen regnes som bilen, ikke dekor.`);
  /**
   * Tegnede avstander er satt for et ark i 1:30. Er arket skalert (Vito
   * 304160 er tegnet i 1:2,5, tolv ganger stoerre), skaleres de med, saa
   * bokstavene i et ord fortsatt er én klynge.
   */
  const T = MM * Math.max(1, 30 / malestokk);
  const kulorte = lest.bokser.filter((b) => kulor(b) && !erLakk(b) && !(lakkMoerk && svart(b)));

  /**
   * Moerk bil (Eirik 16.11.2026, Mercedes Vito, sort): da er sort bilens
   * lakk, og hvitt er designerens. Reglene for sort og hvitt byttes om:
   * sort avslutter en dekorbolk og er aldri dekor, hvit i en dekorbolk er
   * kandidat og hentes inn som nabo («VILLANGER» under roed «CENTER» foran,
   * «24 timers service» paa ruta). Lys bil (Kia, Proace, e-expert) er som foer.
   */
  // en bane som bare strekes, er ikke en hvit flate selv om fyllfargen som staar er hvit
  const lys = (b: Boks) => !b.bareStrek && !!b.farge && b.farge.length === 4 && Math.max(...b.farge) < 0.03;
  const sideA = (lest.side.x1 - lest.side.x0) * (lest.side.y1 - lest.side.y0);
  const arealAv = (f: (b: Boks) => boolean) => lest.bokser.filter((b) => f(b) &&
    (b.x1 - b.x0) * (b.y1 - b.y0) < 0.25 * sideA).reduce((a, b) => a + (b.x1 - b.x0) * (b.y1 - b.y0), 0);
  const moerkBil = lakkMoerk ?? (arealAv(svart) > arealAv(lys));
  /** designerens noeytrale farge: sort paa lys bil, hvit paa moerk */
  const noytral = moerkBil ? lys : svart;

  /**
   * Tegnerekkefoelgen skiller designerens sort fra bilens. CCVision tegner
   * bilen i K-graatoner med noen faa K 100-deler (grill, list, hjulbue)
   * spredt mellom dem. Designeren legger dekoren oppaa, samlet: paa Kia PV5
   * (310079) ligger gronn og sort vekselvis i to sammenhengende bolker uten
   * en eneste bilgraa imellom. En «dekorbolk» er en sammenhengende rekke
   * flater uten bilgraa eller lyktefarge, som inneholder minst en ekte
   * kulort flate. Sort og hvitt teller som dekor bare i en slik bolk.
   */
  const bilTone = (b: Boks) => !!b.farge && b.farge.length === 4 &&
    Math.max(b.farge[0], b.farge[1], b.farge[2]) < 0.01 && b.farge[3] > 0.01 && b.farge[3] < 0.99;
  /** ekte kuloer, ikke rik sort: CMY ulike */
  const ekte = (b: Boks) => !!b.farge &&
    Math.max(b.farge[0], b.farge[1], b.farge[2]) - Math.min(b.farge[0], b.farge[1], b.farge[2]) > 0.2;
  const iDekorbolk = new Set<Boks>();
  {
    let bolk: Boks[] = [];
    let harKulor = false, lyse = 0;
    /**
     * Paa moerk bil er hvit tekst alene dekor («24 timers service» paa ruta
     * paa Vito). En bolk med minst LYS_BOLK hvite flater teller som dekor;
     * et hvitt skilt eller en refleks i bilen er én eller to flater.
     */
    const LYS_BOLK = 6;
    const avslutt = () => {
      if (harKulor || (moerkBil && lyse >= LYS_BOLK)) for (const b of bolk) iDekorbolk.add(b);
      bolk = []; harKulor = false; lyse = 0;
    };
    for (const b of lest.bokser) {
      if (bilTone(b) || BILFARGER.has(fargenavn(b)) || erLakk(b) || (moerkBil && svart(b))) { avslutt(); continue; }
      bolk.push(b);
      if (ekte(b)) harKulor = true;
      if (lys(b)) lyse++;
    }
    avslutt();
  }

  // 2. skissens egne farger: de som ogsa brukes til harstrek.
  //    Dette ma gjores forst, for malpilene binder visningene sammen
  //    til en klump hvis de far vaere med naar visningene skal finnes.
  const malfarge = new Set<string>();
  for (const b of kulorte) if (BILFARGER.has(fargenavn(b))) malfarge.add(fargenavn(b));
  for (const b of kulorte) {
    const w = (b.x1 - b.x0) / MM, h = (b.y1 - b.y0) / MM;
    const t = Math.min(w, h), L = Math.max(w, h);
    if (t < HARSTREK_MM && L / Math.max(t, 1e-9) > HARSTREK_FORHOLD) malfarge.add(fargenavn(b));
  }
  if (malfarge.size) merknader.push(
    `Skissens egne farger (brukt til malpiler og hjelpelinjer): ${[...malfarge].join(" og ")}.`);

  const rene = lest.bokser.filter((b) => !malfarge.has(fargenavn(b)));
  const visninger = finnVisninger(rene, malestokk, dim);

  if (!kulorte.length && !lest.bokser.some((b) => noytral(b) && iDekorbolk.has(b))) {
    merknader.push("Skissen har ingen kulorte flater. Enten er den umalt, " +
      "eller sa er dekoren i sort og hvitt. Da ma dekoren merkes for hand.");
    return { visninger, omraader: [], forkastet, merknader };
  }

  const iVisning = (b: Boks) => visninger.some((v) => andelInni(b, v) >= 0.5);
  const fotoer = bilder.filter((b) => iVisning(b) &&
    Math.max(b.x1 - b.x0, b.y1 - b.y0) / MM * malestokk >= MINSTE_EKTE_MM);
  if (fotoer.length) merknader.push(`Skissen har ${fotoer.length} innsatt${fotoer.length > 1 ? "e" : ""} bilde${fotoer.length > 1 ? "r" : ""} paa bilen ` +
    `(${fotoer.map((b) => `${Math.round((b.x1 - b.x0) / MM * malestokk)} x ${Math.round((b.y1 - b.y0) / MM * malestokk)} mm`).join(", ")}). ` +
    "Bilder er IKKE med i skjaerefilene. De maa printes fra originalfila.");
  const kandidater = kulorte.filter((b) => {
    if (malfarge.has(fargenavn(b))) return false;
    if (!iVisning(b)) return false;
    return true;
  }).concat(
    /**
     * Sort dekor uten kuloer ved siden av: «åtg.no» og «- RØR» bak paa
     * Kia PV5 (310079) staar alene i sort. Sort fra en dekorbolk er
     * designerens og er en kandidat i seg selv.
     */
    lest.bokser.filter((b) => !kulor(b) && noytral(b) && iVisning(b) && (iDekorbolk.has(b) ||
      /**
       * Paa moerk bil er en stor hvit flate dekor selv om den staar alene i
       * tegnerekkefoelgen (Vito 304160: den store Ø-en paa venstre side er
       * to flater, tegnet mellom bildeler). Bilens egne hvite deler er
       * smaa (lys, refleks) eller nummerskiltet, som tas for seg.
       */
      (moerkBil && Math.max(b.x1 - b.x0, b.y1 - b.y0) / MM * malestokk >= STOR_LYS_MM))));
  const fjernetFarge = kulorte.filter((b) => malfarge.has(fargenavn(b))).length;
  if (fjernetFarge) forkastet.push({ hva: `${fjernetFarge} flater`, grunn: "skissens egne farger" });
  const utenfor = kulorte.filter((b) => !malfarge.has(fargenavn(b)) && !iVisning(b)).length;
  if (utenfor) forkastet.push({ hva: `${utenfor} flater`, grunn: "ligger utenfor visningene" });

  // 4. klynger, en klynge er ett element
  const omraader: DekorOmraade[] = [];
  for (const g of klynger(kandidater, KLYNGE_MM * T)) {
    let r = ramme(g);
    const bE = ((r.x1 - r.x0) / MM) * malestokk;
    const hE = ((r.y1 - r.y0) / MM) * malestokk;
    if (bE < MINSTE_EKTE_MM && hE < MINSTE_EKTE_MM) {
      forkastet.push({ hva: `${g.length} flater ved x${(r.x0 / MM).toFixed(0)} y${(r.y0 / MM).toFixed(0)}`,
        grunn: `bare ${bE.toFixed(0)} x ${hE.toFixed(0)} mm i virkeligheten` });
      continue;
    }
    /**
     * Nummerskiltet er bilens: et hvitt rektangel paa 520 x 110 mm (EU-skilt,
     * Vito 304160 bak). Én eller to flater i hvitt i den stoerrelsen.
     */
    const fA = (b: Boks) => (b.x1 - b.x0) * (b.y1 - b.y0);
    const lysAndel = g.filter(lys).reduce((a, b) => a + fA(b), 0) / Math.max(1e-9, g.reduce((a, b) => a + fA(b), 0));
    // skiltet kan ha sort kant og tegnet tekst (E-Partner 306005: 567 x 117)
    if (g.length <= 6 && lysAndel >= 0.6 && bE > 470 && bE < 600 && hE > 90 && hE < 140) {
      forkastet.push({ hva: `${g.length} flater ved x${(r.x0 / MM).toFixed(0)} y${(r.y0 / MM).toFixed(0)}`,
        grunn: `nummerskilt (${bE.toFixed(0)} x ${hE.toFixed(0)} mm)` });
      continue;
    }
    // 5. hvite og sorte deler av samme logo
    let med = g.slice();
    /**
     * 5a. Svarte deler som staar ved siden av, ikke inni. Paa Kia PV5
     *     (310079) er «ATG» sorte bokstaver over en gronn strek og med en
     *     gronn trekant i A-en. Bare streken og trekanten kom med; ramma
     *     deres rommer ikke bokstavene. Svart (K 100 eller rik sort) som
     *     ligger mindre enn NABO_MM fra den kulorte kjernen, og som ikke er
     *     stoerre enn kjernen selv, hoerer til logoen. Bare ett ledd fra
     *     kjernen, ikke kjede: CCVision tegner ogsaa deler av bilen i K 100
     *     (grill, list), og en kjede ville spist seg inn i dem.
     */
    {
      const kjerne = ramme(g);
      const maks = Math.max(kjerne.x1 - kjerne.x0, kjerne.y1 - kjerne.y0);
      // i flere ledd, men bare innenfor dekorbolkene: ringen i Å ligger
      // inntil A-en, ikke inntil den gronne streken
      for (let ledd = 0; ledd < 4; ledd++) {
        const naer = (b: Boks) => med.some((m) => Math.hypot(
          Math.max(0, m.x0 - b.x1, b.x0 - m.x1), Math.max(0, m.y0 - b.y1, b.y0 - m.y1)) <= NABO_MM * T);
        const nabo = lest.bokser.filter((b) => !med.includes(b) && noytral(b) && iVisning(b) &&
          iDekorbolk.has(b) && Math.max(b.x1 - b.x0, b.y1 - b.y0) <= maks && naer(b));
        if (!nabo.length) break;
        med = med.concat(nabo); r = ramme(med);
      }
    }
    for (let runde = 0; runde < 3; runde++) {
      const pad = { x0: r.x0 - 1 * T, y0: r.y0 - 1 * T, x1: r.x1 + 1 * T, y1: r.y1 + 1 * T };
      // bare flater fra en dekorbolk: bilens deler inne i rammen er bil
      const nye = lest.bokser.filter((b) => !med.includes(b) && andelInni(b, pad) >= 0.9 &&
        iDekorbolk.has(b));
      if (!nye.length) break;
      med = med.concat(nye);
      r = ramme(med);
    }
    /**
     * 6. Bilen er tegnet i rene graatoner (bare K). Bestaar en klynge
     *    for en stor del av slike flater, har vi fanget en del av bilen,
     *    ikke dekor. Paa 309916 e-expert var det dekket paa bakhjulet,
     *    tegnet i rik sort, med felg og hjulbue i K-graatt rundt.
     *    Dekor i graatt kommer fra kunden som RGB eller med kuloer, og
     *    rammes ikke.
     */
    const flate = (b: Boks) => (b.x1 - b.x0) * (b.y1 - b.y0);
    const rentGraatt = (b: Boks) => !!b.farge && b.farge.length === 4 &&
      Math.max(b.farge[0], b.farge[1], b.farge[2]) < 0.01 && b.farge[3] > 0.03 && b.farge[3] < 0.97;
    // maales paa alt inne i rammen, ogsaa det som ikke tas med i elementet
    const iRamme = lest.bokser.filter((b) => andelInni(b, r) >= 0.9);
    const graaAndel = iRamme.filter(rentGraatt).reduce((a, b) => a + flate(b), 0) /
      Math.max(iRamme.reduce((a, b) => a + flate(b), 0), 1e-9);
    /*
     *    Gjelder bare klynger uten ekte kuloer i kjernen (bare rik sort o.l.,
     *    som dekket paa e-expert). Paa Kia PV5 (310079) gaar de gronne
     *    stripene over doerer, haandtak og vindu, saa rammen deres er full
     *    av bil; de er likevel dekor, fordi kjernen er gronn. Bildelene
     *    inne i rammen holdes ute av elementet i bilmotor.ts.
     */
    const ekteKulor = g.some(ekte);
    // en stor hvit flate paa moerk bil er dekor selv om den ligger over hjul og lister
    const storLys = moerkBil && g.some((b) => lys(b) && Math.max(b.x1 - b.x0, b.y1 - b.y0) / MM * malestokk >= STOR_LYS_MM);
    if (!ekteKulor && !storLys && graaAndel > BILGRAA_ANDEL) {
      forkastet.push({ hva: `${med.length} flater ved x${(r.x0 / MM).toFixed(0)} y${(r.y0 / MM).toFixed(0)}`,
        grunn: `${(graaAndel * 100).toFixed(0)} % er bilens graatoner` });
      continue;
    }
    const v = visninger.find((vv) => andelInni(r, vv) >= 0.5);
    omraader.push({
      ...r, vis: v?.navn ?? "ukjent", navn: "dekor",
      bokser: med.length, liste: med,
      farger: [...new Set(med.filter(kulor).map(fargenavn))],
      breddeEkteMm: ((r.x1 - r.x0) / MM) * malestokk,
      hoydeEkteMm: ((r.y1 - r.y0) / MM) * malestokk,
      sikkerhet: "sikker",
    });
  }

  // et omraade som allerede ligger helt i et annet (teksten inne i stripenes
  // ramme paa Kia PV5) skal ikke skjaeres to ganger
  for (let i = omraader.length - 1; i >= 0; i--) {
    const a = omraader[i];
    if (omraader.some((b, j) => j !== i && b.liste.length > a.liste.length &&
        a.liste.every((x) => b.liste.includes(x)))) omraader.splice(i, 1);
  }

  /**
   * To omraader som deler flater, er samme dekor (Vito bak: teksten «24
   * timers service» ble halvt hentet inn i rammen til den roede flaten og
   * halvt et eget omraade, og ble skaaret to ganger). De slaas sammen;
   * samleDeler i bilmotor.ts deler dem igjen der delene staar hver for seg.
   */
  for (let endret = true; endret;) {
    endret = false;
    for (let i = 0; i < omraader.length && !endret; i++) for (let j = i + 1; j < omraader.length && !endret; j++) {
      const a = omraader[i], b = omraader[j];
      if (a.vis !== b.vis || !a.liste.some((x) => b.liste.includes(x))) continue;
      const liste = [...new Set([...a.liste, ...b.liste])];
      const r = ramme(liste);
      omraader[i] = { ...a, ...r, liste, bokser: liste.length,
        farger: [...new Set(liste.filter(kulor).map(fargenavn))],
        breddeEkteMm: ((r.x1 - r.x0) / MM) * malestokk, hoydeEkteMm: ((r.y1 - r.y0) / MM) * malestokk };
      omraader.splice(j, 1);
      endret = true;
    }
  }

  // nummerer per visning
  const n = new Map<string, number>();
  for (const o of omraader.sort((a, b) => b.y1 - a.y1 || a.x0 - b.x0)) {
    const i = (n.get(o.vis) ?? 0) + 1;
    n.set(o.vis, i);
    o.navn = `dekor ${i}`;
  }
  if (!omraader.length) merknader.push("Fant ingen dekor. Skissen ma merkes for hand.");
  return { visninger, omraader, forkastet, merknader };
}
