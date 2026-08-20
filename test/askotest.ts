/**
 * Fanger brudd paa lagreglene, maalt paa ASKO reklame-logoen.
 *
 * Logoen har fire farger: to nesten like vinrode nyanser (`a` og `sko`), en
 * nesten hvit tekst, og en gronn snakkeboble. Den treffer fire regler:
 *
 *   1. Fire farger skal skilles. To nyanser som ligger tett skal ikke slaas
 *      sammen av separeringen.
 *   2. Den nesten hvite teksten er en farge, ikke et hull. Faar den folie,
 *      skal den skjaeres positivt.
 *   3. Ingen farge skjaeres bade positivt og negativt. Enten faar den folie
 *      og skjaeres, eller den settes til hull og staar apen. Aldri begge.
 *   4. Et lag fyller bare hullene innenfor sin egen form. Det som ligger ved
 *      siden av, skal ikke med. Vi legger ikke folie oppa folie uten grunn.
 *
 * Alt maales paa de ferdige skjaerefilene fra kjorJobb, ikke paa en kopi av
 * regelen inne i testen. En test som gjenskaper regelen ville bestaatt selv
 * om regelen ble fjernet fra motoren.
 *
 * Regel 4 ryker lettest uten at noe annet merker det. Malt med den gamle
 * regelen, der hvert lag tok med seg alt som la over:
 *
 *      lag              egenareal   ny regel   gammel regel
 *      #4A0019   vinrod      708.7      708.7          708.7
 *      #480017   vinrod     2254.7     2254.7         2963.3
 *      #F4F7F6   tekst       315.8      315.8         3279.1   <- 10,4 ganger
 *      #6FF030   boble      5669.2     5984.9         9382.2   <- 1,65 ganger
 *
 * Teksten fikk hele ASKO under seg, og boblen fikk hele logoen. Maalt paa
 * arkene blir hvit da like stor som vinrod, i stedet for en tiendedel.
 *
 * Testen avslutter med kode 1 hvis noen av de fire reglene brytes.
 */
import * as fs from "fs";
import { kjorJobb, analyserFil } from "../src/motor";
import { PDFDocument, PDFRawStream, decodePDFRawStream, PDFName } from "pdf-lib";

const VINROD = "751-049", HVIT = "751-010", GRONN = "751-021";

const feil: string[] = [];
const sjekk = (ok: boolean, tekst: string) => {
  console.log(`   ${ok ? "ok  " : "FEIL"}  ${tekst}`);
  if (!ok) feil.push(tekst);
};

/** Samlet areal av alt som tegnes i elementene paa et ark. */
async function arkAreal(bytes: Uint8Array): Promise<number> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  let sum = 0;
  const les = (t: string) => {
    const tok = t.match(/-?[\d.]+|[A-Za-z*'"]+/g) ?? [];
    let tall: number[] = [];
    let bane: [number, number][] = [];
    const slutt = () => {
      if (bane.length > 2) {
        let s = 0;
        for (let i = 0; i < bane.length; i++) {
          const a = bane[i], b = bane[(i + 1) % bane.length];
          s += a[0] * b[1] - b[0] * a[1];
        }
        sum += Math.abs(s / 2);
      }
      bane = [];
    };
    for (const k of tok) {
      if (/^-?[\d.]+$/.test(k)) { tall.push(parseFloat(k)); continue; }
      const p = (): [number, number] => [tall[tall.length - 2], tall[tall.length - 1]];
      if (k === "m") { slutt(); bane = [p()]; }
      else if (k === "l" || k === "c") bane.push(p());
      else if ("h f f* S s B B* b n".split(" ").includes(k)) slutt();
      tall = [];
    }
    slutt();
  };
  for (let i = 0; i < doc.getPageCount(); i++) {
    const side: any = doc.getPage(i);
    const xo: any = side.node.Resources()?.lookup(PDFName.of("XObject"));
    if (xo?.keys) for (const k of xo.keys()) {
      try {
        les(new TextDecoder("latin1").decode(decodePDFRawStream(xo.lookup(k)).decode()));
      } catch { /* ikke en lesbar strom */ }
    }
  }
  return sum;
}

/** Areal per foliekode for en kjoring. */
async function kjor(pdf: Uint8Array, hvitValg: any) {
  const r: any = await kjorJobb({
    jobb: "ASKO", egenSkisse: false,
    linjer: [{
      navn: "ASKO", pdf, breddeMm: 400, antall: 1,
      folier: [
        { kode: VINROD, hex: "#4A0019", breddeMm: 1220 },
        { kode: VINROD, hex: "#480017", breddeMm: 1220 },
        hvitValg,
        { kode: GRONN, hex: "#6FF030", breddeMm: 1220 },
      ],
    } as any],
  });
  const per = new Map<string, number>();
  for (const f of r.filer) {
    if (!f.navn.endsWith(".pdf") || f.navn.includes("skisse") || f.navn.includes("wild")) continue;
    const kode = (f.navn.match(/(\d{3}-\d{3})/) ?? [])[1];
    if (kode) per.set(kode, (per.get(kode) ?? 0) + await arkAreal(f.bytes));
  }
  return { ark: r.ark as any[], areal: per };
}

(async () => {
  const pdf = new Uint8Array(fs.readFileSync("asko.ai"));

  console.log("1. fire farger, og de to vinrode holdes fra hverandre");
  const a = await analyserFil(pdf);
  const hexer = a.farger.map((f) => f.hex);
  console.log(`   farger: ${hexer.join(" ")}`);
  sjekk(a.farger.length === 4, `fire farger (fikk ${a.farger.length})`);
  sjekk(new Set(hexer).size === hexer.length, "ingen to farger har samme hex");
  sjekk(hexer.includes("#4A0019") && hexer.includes("#480017"),
        "begge vinrode nyansene er med, #4A0019 og #480017");

  console.log("\n2. den nesten hvite teksten er en farge, ikke et hull");
  const tekst = a.farger.find((f) => f.hex === "#F4F7F6");
  sjekk(!!tekst, "#F4F7F6 finnes som eget fargelag");
  sjekk(tekst ? tekst.hvit === false : false, "#F4F7F6 er ikke merket hvit");

  const medFolie = await kjor(pdf, { kode: HVIT, hex: "#FFFFFF", breddeMm: 1220 });
  const rod = medFolie.areal.get(VINROD) ?? 0;
  const hvit = medFolie.areal.get(HVIT) ?? 0;
  const gronn = medFolie.areal.get(GRONN) ?? 0;
  console.log(`   ark: ${VINROD} ${rod.toFixed(0)}   ${HVIT} ${hvit.toFixed(0)}   ${GRONN} ${gronn.toFixed(0)}`);
  sjekk(hvit > 0, `#F4F7F6 skjaeres positivt i hvit folie (areal ${hvit.toFixed(0)})`);

  console.log("\n3. ingen farge skjaeres bade positivt og negativt");
  const somHull = await kjor(pdf, "hull");
  const koderHull = somHull.ark.map((k) => k.foliekode);
  console.log(`   settes hvit til hull -> ark: ${koderHull.join(", ")}`);
  sjekk(!koderHull.includes(HVIT),
        "settes fargen til hull, lages det ikke ark i hvit folie");
  sjekk(medFolie.ark.map((k) => k.foliekode).includes(HVIT),
        "settes den til folie, lages arket");
  sjekk((somHull.areal.get(HVIT) ?? 0) === 0,
        "ingen flate skjaeres i hvit folie naar fargen staar som hull");

  console.log("\n4. et lag fyller bare innenfor sin egen form");
  sjekk(hvit < 0.5 * rod,
        `den nesten hvite teksten svelger ikke ASKO ` +
        `(hvit ${hvit.toFixed(0)} mot vinrod ${rod.toFixed(0)}, ` +
        `forhold ${(hvit / rod).toFixed(2)}, krav under 0.50)`);
  sjekk(gronn < 2 * rod,
        `snakkeboblen svelger ikke hele logoen ` +
        `(gronn ${gronn.toFixed(0)} mot vinrod ${rod.toFixed(0)}, ` +
        `forhold ${(gronn / rod).toFixed(2)}, krav under 2.00)`);

  console.log();
  if (feil.length) {
    console.log(`FEIL: ${feil.length} brudd paa lagreglene.`);
    process.exit(1);
  }
  console.log("ok: alle fire lagreglene holder");
})();
