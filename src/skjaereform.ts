/**
 * Bygger et rent skjaeremotiv som Form XObject fra ferdig sammenslatt geometri.
 *
 *   fyll  = foliefargen
 *   strek = spotfargen CutContour med korrekt vekt malt pa arket
 *
 * Strekvekten deles pa skalaen formen tegnes med. Ellers vokser streken
 * sammen med motivet: en logo som forstorres 90 ganger ville fatt 22 punkts
 * skjaerelinje i stedet for 0,25.
 */
import { PDFDocument, PDFName, PDFRef } from "pdf-lib";
import type { MultiPoly } from "./pdfbaner.ts";

const f4 = (n: number) => n.toFixed(4);

export function separasjon(doc: PDFDocument, navn: string, c1: number[]): PDFRef {
  const tint = doc.context.register(
    doc.context.obj({
      FunctionType: 2, Domain: [0, 1],
      C0: [0, 0, 0, 0], C1: c1, N: 1,
    })
  );
  return doc.context.register(
    doc.context.obj([
      PDFName.of("Separation"), PDFName.of(navn), PDFName.of("DeviceCMYK"), tint,
    ])
  );
}

function ringOps(ring: [number, number][]): string {
  const ut: string[] = [`${f4(ring[0][0])} ${f4(ring[0][1])} m`];
  for (let i = 1; i < ring.length; i++) ut.push(`${f4(ring[i][0])} ${f4(ring[i][1])} l`);
  ut.push("h");
  return ut.join("\n") + "\n";
}

export interface Skjaereform {
  ref: PDFRef;
  ringer: number;
  bbox: [number, number, number, number];
}

/**
 * flate: geometrien i kildens punktkoordinater
 * skala: hvor mange ganger formen forstorres naar den plasseres
 */
export function byggSkjaereform(
  doc: PDFDocument,
  flate: MultiPoly,
  bbox: [number, number, number, number],
  skala: number,
  fyllOp = "0 0 0 0 k",
  strekPt = 0.25,
  csNavn = "CSX"
): Skjaereform {
  const ops: string[] = [
    fyllOp + "\n",
    `/${csNavn} CS\n1 SCN\n${(strekPt / Math.max(skala, 1e-9)).toFixed(6)} w\n`,
  ];
  let ringer = 0;
  for (const poly of flate) {
    if (!poly.length) continue;
    for (const ring of poly) {
      if (ring.length < 3) continue;
      ops.push(ringOps(ring));
      ringer++;
    }
    // hullene skal ikke fylles, derfor partall-oddetall
    ops.push("B*\n");
  }

  const cut = separasjon(doc, "CutContour", [0, 1, 0, 0]);
  const strm = doc.context.flateStream(ops.join(""));
  const dict = (strm as any).dict;
  dict.set(PDFName.of("Type"), PDFName.of("XObject"));
  dict.set(PDFName.of("Subtype"), PDFName.of("Form"));
  dict.set(PDFName.of("BBox"),
           doc.context.obj([bbox[0] - 2, bbox[1] - 2, bbox[2] + 2, bbox[3] + 2]));
  dict.set(PDFName.of("Matrix"), doc.context.obj([1, 0, 0, 1, 0, 0]));
  const cs = doc.context.obj({});
  cs.set(PDFName.of(csNavn), cut);
  dict.set(PDFName.of("Resources"), doc.context.obj({ ColorSpace: cs }));

  return { ref: doc.context.register(strm), ringer, bbox };
}
