import * as fs from "fs";
import { kjorJobb, analyserFil } from "../src/motor";
const les = (p: string) => new Uint8Array(fs.readFileSync(p));
const SORT = { kode: "751-070", hex: "#1A1A1A", breddeMm: 1260 };
const HVIT = { kode: "751-010", hex: "#FFFFFF", breddeMm: 1260 };

(async () => {
  const pdf = les("kirke.pdf");
  const a = await analyserFil(pdf);
  console.log("ANALYSERFIL");
  for (const f of a.farger) console.log(`   ${f.hex} ${f.hvit ? "hvit" : "    "}  ${(f.andel*100).toFixed(1)} %`);

  const varianter: [string, any[]][] = [
    ["hvit som hull (som for)", [null, "hull"].map((v,i)=> i===0?SORT:"hull")],
    ["hvit skjaeres i hvit folie", [SORT, HVIT]],
  ];
  // fargene kommer hvit forst (67,4 %), sa rekkefolgen ma folge analysen
  const rekke = a.farger.map(f => f.hvit);
  for (const [navn, _] of varianter) {
    const folier = rekke.map((erHvit) =>
      erHvit ? (navn.includes("hull") ? "hull" as const : HVIT) : SORT);
    const r = await kjorJobb({ jobb: "Kyrkja", linjer: [
      { navn: "Den norske kyrkje", pdf, breddeMm: 300, antall: 6, folier }] });
    const x = r.analyse[0];
    console.log(`\n${navn}`);
    console.log(`   ${x.breddeMm.toFixed(1)} x ${x.hoydeMm.toFixed(1)} mm | folier ${x.foliekoder.join(" + ")} | ` +
      `tynneste ${x.tynnesteMm.toFixed(2)} mm | ${x.status}`);
    for (const k of r.ark) console.log(`   ark ${k.foliekode} ${k.rolle}: ${k.breddeMm} x ${k.lengdeMm.toFixed(0)} mm`);
  }
})();
