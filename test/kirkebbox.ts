import * as fs from "fs";
import { hentGeometri, hentGeometriPerFarge, areal } from "../src/pdfbaner";
(async () => {
  const b = new Uint8Array(fs.readFileSync("kirke.pdf"));
  const g = await hentGeometriPerFarge(b, 1.0);
  const m = await hentGeometri(b, 1.0);
  const boks = (f: any) => {
    let x0=1e9,y0=1e9,x1=-1e9,y1=-1e9;
    for (const p of f) for (const r of p) for (const [x,y] of r) {
      x0=Math.min(x0,x);x1=Math.max(x1,x);y0=Math.min(y0,y);y1=Math.max(y1,y); }
    return `${(x1-x0).toFixed(1)} x ${(y1-y0).toFixed(1)} pt`;
  };
  console.log("union bbox :", g.bbox.map(v=>v.toFixed(1)).join(", "));
  console.log("merged bbox:", m.bbox.map(v=>v.toFixed(1)).join(", "));
  for (const l of g.lag) console.log(`  ${l.hex} ${l.hvit?"hvit":"    "}  boks ${boks(l.flate)}  flater ${l.flate.length}`);
})();
