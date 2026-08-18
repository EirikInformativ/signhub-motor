import * as fs from "fs";
import { hentGeometriPerFarge, areal } from "../src/pdfbaner";
const MM = 72/25.4;
(async () => {
  const b = new Uint8Array(fs.readFileSync("/home/claude/Informativ_logo_rod_prikk.pdf"));
  const g0 = await hentGeometriPerFarge(b, 1.0);
  const skala = (250 * MM) / (g0.bbox[2] - g0.bbox[0]);
  const g = await hentGeometriPerFarge(b, skala);
  for (const l of g.lag) {
    let x0=1e9,y0=1e9,x1=-1e9,y1=-1e9;
    for (const p of l.flate) for (const r of p) for (const [x,y] of r) {
      x0=Math.min(x0,x); x1=Math.max(x1,x); y0=Math.min(y0,y); y1=Math.max(y1,y);
    }
    console.log(`${l.hex}  boks ${((x1-x0)*skala/MM).toFixed(1)} x ${((y1-y0)*skala/MM).toFixed(1)} mm` +
      `  areal ${(areal(l.flate)*skala*skala/(MM*MM)/100).toFixed(2)} cm2`);
  }
})();
