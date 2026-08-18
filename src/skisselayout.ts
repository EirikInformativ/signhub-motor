/**
 * Regner ut hvor alt skal sta pa kundeskissen.
 *
 * Layouten ligger for seg selv fordi skissen tegnes to steder: som vektor
 * (arkiv og internt) og pa lerret (kundeversjonen som brennes flat). De to
 * ma vaere identiske, sa de deler denne.
 *
 * Alle mal er i millimeter, og y males fra bunnen av arket slik PDF gjor det.
 */
import type { MultiPoly } from "./pdfbaner.ts";

export const MM = 72 / 25.4;
export const A4 = { b: 210, h: 297 };
export const MARGIN = 15;
/** disclaimerblokken i malen, i punkter fra bunn */
export const DISCLAIMER = { bunn: 13.92, topp: 60.96 };
const ETIKETT_H = 5.5;
const LUFT = 11;
const ADVARSEL_H = 4.2;

export interface SkisseMotiv {
  navn: string;
  flate: MultiPoly;
  bbox: [number, number, number, number];
  breddeMm: number;
  hoydeMm: number;
  antall: number;
  status: "ok" | "tynn" | "kritisk";
  tynnesteMm: number;
  minBreddeMm: number;
  /** foliefargen elementet skjaeres i, slik den er lagret pa komponentvaren */
  hex: string;
  /** samme farge som CMYK, til vektorskissen */
  cmyk: [number, number, number, number];
  /**
   * Er motivet delt i flere farger, ligger delene her, hver med sin folie.
   * Da tegnes de i stedet for flate, i den rekkefolgen de star.
   */
  deler?: { hex: string; cmyk: [number, number, number, number]; flate: MultiPoly }[];
}

export interface Felt {
  kundenavn?: string; kundenummer?: string; ordrenummer?: string;
  deresKontakt?: string; varKontakt?: string; korrekturdato?: string;
}

export interface FeltRad { x: number; y: number; navn: string; verdi: string }

export interface Element {
  motiv: SkisseMotiv;
  x: number; y: number;      // nedre venstre hjorne av motivet
  b: number; h: number;      // vist storrelse
  etikett: string; etikettY: number;
  advarsel: string | null; advarselY: number;
}

export interface Layout {
  skala: number;
  tittelY: number;
  felter: FeltRad[];
  malestokkTekst: string;
  malestokkY: number;
  regelY: number;
  elementer: Element[];
  /** vannmerket skal ligge mellom disse, i mm fra bunn */
  vannmerkeTopp: number;
  vannmerkeBunn: number;
}

const komma = (n: number, d: number) => n.toFixed(d).replace(".", ",");

export function beregnLayout(motiver: SkisseMotiv[], felt: Felt): Layout {
  let y = A4.h - 20;
  const tittelY = y;
  y -= 7;

  const par: [keyof Felt, string][] = [
    ["kundenavn", "Kunde"], ["kundenummer", "Kundenr."],
    ["ordrenummer", "Tilbud/ordre"], ["deresKontakt", "Deres kontaktperson"],
    ["varKontakt", "Vår kontaktperson"], ["korrekturdato", "Korrekturdato"],
  ];
  const rader = par.filter(([k]) => felt[k]).map(([k, vis]) => [vis, String(felt[k])] as [string, string]);
  const kol = [MARGIN, MARGIN + (A4.b - 2 * MARGIN) / 2];
  const per = Math.max(1, Math.ceil(rader.length / 2));
  const y0 = y;
  const felter: FeltRad[] = rader.map(([navn, verdi], i) => ({
    x: kol[Math.floor(i / per)], y: y0 - 4.6 * (i % per), navn, verdi,
  }));
  if (rader.length) y = y0 - 4.6 * (per - 1) - 6;

  const antAdvarsler = motiver.filter((m) => m.status !== "ok").length;
  const fast = motiver.length * (ETIKETT_H + LUFT) + antAdvarsler * ADVARSEL_H;
  const sumH = motiver.reduce((s, m) => s + m.hoydeMm, 0);
  const topp = y - 8;
  const bunn = DISCLAIMER.topp / MM + 8;
  const maks = Math.max(...motiver.map((m) => m.breddeMm));
  const skala = Math.min((A4.b - 2 * MARGIN) / maks, (topp - bunn - fast) / sumH);

  const malestokkY = y;
  const malestokkTekst = `Alle motiver vist i samme målestokk 1:${komma(1 / skala, 1)}`;
  y -= 4;
  const regelY = y;

  const blokk = sumH * skala + fast - LUFT;
  y = bunn + (topp - bunn + blokk) / 2;

  const elementer: Element[] = [];
  for (const m of [...motiver].sort((a, b) => b.breddeMm - a.breddeMm)) {
    const b = m.breddeMm * skala;
    const h = m.hoydeMm * skala;
    y -= h;
    const el: Element = {
      motiv: m, x: (A4.b - b) / 2, y, b, h,
      etikett: `${m.navn}      ${komma(m.breddeMm, 1)} x ${komma(m.hoydeMm, 1)} mm      ${m.antall} stk`,
      etikettY: y - ETIKETT_H, advarsel: null, advarselY: 0,
    };
    y -= ETIKETT_H;
    if (m.status !== "ok") {
      y -= ADVARSEL_H;
      el.advarselY = y;
      el.advarsel = m.status === "kritisk"
        ? `Kan ikke skjæres i denne størrelsen. Tynneste detalj ${komma(m.tynnesteMm, 2)} mm. ` +
          `Minste anbefalte bredde ${m.minBreddeMm.toFixed(0)} mm.`
        : `Tynneste detalj ${komma(m.tynnesteMm, 2)} mm. Krevende luking, kontroller før produksjon.`;
    }
    y -= LUFT;
    elementer.push(el);
  }

  return {
    skala, tittelY, felter, malestokkTekst, malestokkY, regelY, elementer,
    vannmerkeTopp: regelY - 4,
    vannmerkeBunn: (DISCLAIMER.topp + 6) / MM,
  };
}
