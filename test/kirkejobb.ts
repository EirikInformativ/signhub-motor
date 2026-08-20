import * as fs from "fs";
import { kjorJobb, analyserFil } from "../src/motor";
import { PDFDocument, PDFRawStream, decodePDFRawStream } from "pdf-lib";
const les = (p: string) => new Uint8Array(fs.readFileSync(p));
const SORT = { kode: "751-070", hex: "#1A1A1A", breddeMm: 1260 };
const HVIT = { kode: "751-010", hex: "#FFFFFF", breddeMm: 1260 };

(async () => {
  const pdf = les("kirke.pdf");
  const a = await analyserFil(pdf);
  console.log("ANALYSERFIL");
  for (const f of a.farger) console.log(`   ${f.hex} ${f.hvit ? "hvit" : "    "}  ${(f.andel*100).toFixed(1)} %`);

  // fargene kommer hvit forst (67,4 %), sa rekkefolgen ma folge analysen
  const rekke = a.farger.map(f => f.hvit);
  const kjor = async (hvitValg: any) => {
    const folier = rekke.map((erHvit) => (erHvit ? hvitValg : SORT));
    return kjorJobb({ jobb: "Kyrkja", linjer: [
      { navn: "Den norske kyrkje", pdf, breddeMm: 300, antall: 6, folier }] });
  };

  const varianter: [string, any][] = [
    ["hvit negativt (som for)", "negativt"],
    ["hvit skjaeres i hvit folie", HVIT],
  ];
  for (const [navn, valg] of varianter) {
    const r = await kjor(valg);
    const x = r.analyse[0];
    console.log(`\n${navn}`);
    console.log(`   ${x.breddeMm.toFixed(1)} x ${x.hoydeMm.toFixed(1)} mm | folier ${x.foliekoder.join(" + ")} | ` +
      `tynneste ${x.tynnesteMm.toFixed(2)} mm | ${x.status}`);
    for (const k of r.ark) console.log(`   ark ${k.foliekode} ${k.rolle}: ${k.breddeMm} x ${k.lengdeMm.toFixed(0)} mm`);
  }

  /**
   * "hull" er det gamle navnet paa "negativt" og skal behandles likt saa
   * lenge appen ennaa kan sende det. Beviset er maalt, ikke paastatt:
   * samme jobb kjores med begge ordene, og hver eneste bane i hver eneste
   * fil skal komme ut identisk.
   *
   * Vi sammenligner de dekomprimerte innholdsstrommene, ikke raa filbytes.
   * pdf-lib legger et tidsstempel i Info-ordboken, og den ligger inne i en
   * komprimert objektstrom, saa krysser de to kjoringene et sekundskille
   * blir hele deflate-utdataen ulik uten at en eneste skjaerelinje er
   * endret. Innholdsstrommene er selve geometrien og er fri for klokke.
   */
  const baner = async (bytes: Uint8Array): Promise<string> => {
    const d = await PDFDocument.load(bytes, { updateMetadata: false });
    const ut: string[] = [];
    for (let i = 0; i < d.getPageCount(); i++) {
      const c = (d.getPage(i) as any).node.Contents();
      const b = c instanceof PDFRawStream ? decodePDFRawStream(c).decode()
              : c?.getContents?.();
      ut.push(b ? new TextDecoder("latin1").decode(b) : "");
    }
    return ut.join("\u0000");
  };

  const ny = await kjor("negativt");
  const gml = await kjor("hull");
  let avvik = 0;
  if (ny.filer.length !== gml.filer.length) avvik++;
  for (let i = 0; i < ny.filer.length; i++) {
    if (ny.filer[i].navn !== gml.filer[i].navn) { avvik++; continue; }
    if (await baner(ny.filer[i].bytes) !== await baner(gml.filer[i].bytes)) avvik++;
  }
  console.log(`\nnegativt vs hull: ${ny.filer.length} filer, ${avvik} avvik` +
    ` -> ${avvik === 0 ? "identiske baner" : "ULIKT"}`);
  if (avvik !== 0) {
    console.error("FEIL: hull gir ikke samme resultat som negativt.");
    process.exit(1);
  }
})();
