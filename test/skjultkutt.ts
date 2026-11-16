/**
 * Ingen skjulte skjaerelinjer i produksjonsfilene.
 *
 * Feil funnet 16.11.2026 (Eirik): Composer, som leser wild-fila, skjaerer
 * alle baner, synlige og usynlige. Motivet ble lagt inn som Form XObject,
 * og Form XObject har en BBox som programmer tolker som en klippebane rundt
 * logoen. Den ble skaaret som en ekstra rute pa logoens storrelse.
 *
 * Testen lager en enkel sirkel, kjorer jobben og krever at ingen
 * produksjonsfil bruker XObject (ingen «Do», ingen /XObject i ressursene),
 * og at alle baner i fila er synlige: strekes (S) eller fylles og strekes
 * (B*). Ingen klippebaner (W) og ingen usynlige baner (n).
 */
import { PDFDocument, PDFName, PDFRawStream, decodePDFRawStream } from "pdf-lib";
import { kjorJobb } from "../src/motor";

function sirkelPdf(): Promise<Uint8Array> {
  return (async () => {
    const doc = await PDFDocument.create();
    const side = doc.addPage([200, 200]);
    side.drawCircle({ x: 100, y: 100, size: 40 });
    return doc.save();
  })();
}

function innhold(bytes: Uint8Array): Promise<{ tekst: string; xobj: boolean }> {
  return (async () => {
    const doc = await PDFDocument.load(bytes);
    const side = doc.getPages()[0];
    const c = side.node.get(PDFName.of("Contents"));
    const strm = doc.context.lookup(c) as PDFRawStream;
    const tekst = new TextDecoder().decode(decodePDFRawStream(strm).decode());
    const res: any = side.node.Resources();
    const xobj = !!res?.get(PDFName.of("XObject"));
    return { tekst, xobj };
  })();
}

(async () => {
  const pdf = await sirkelPdf();
  const r = await kjorJobb({ jobb: "Skjult", linjer: [
    { navn: "Sirkel", pdf, breddeMm: 50, antall: 3,
      folier: [{ kode: "751-027", hex: "#C1121F", breddeMm: 1260 }] }] });
  let feil = 0;
  const prod = r.filer.filter((f: any) => f.slag === "produksjon");
  if (prod.length !== 1 || prod[0].navn !== "Skjult Kiss+thru 751-027 100%.pdf") {
    console.log(`FEIL: ventet én fil «Skjult Kiss+thru 751-027 100%.pdf», fikk ${prod.map((f: any) => f.navn).join(", ")}`); feil++;
  }
  for (const f of prod) {
    const { tekst, xobj } = await innhold(f.bytes);
    const tok = tekst.split(/\s+/);
    const brudd: string[] = [];
    if (xobj) brudd.push("XObject i ressursene");
    if (tok.includes("Do")) brudd.push("Do");
    if (tok.includes("W") || tok.includes("W*")) brudd.push("klippebane W");
    if (tok.includes("n")) brudd.push("usynlig bane n");
    console.log(`${brudd.length ? "FEIL" : "ok  "} ${f.navn}` +
                (brudd.length ? `: ${brudd.join(", ")}` : ""));
    if (brudd.length) feil++;
  }
  if (feil) { console.log(`\n${feil} feil`); process.exit(1); }
  console.log("\nok: ingen skjulte baner");
})();
