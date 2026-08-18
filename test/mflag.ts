import * as fs from "fs";
import { createCanvas } from "@napi-rs/canvas";
import { hentGeometriPerFarge, antallHull } from "../src/pdfbaner";
(async () => {
  const g = await hentGeometriPerFarge(new Uint8Array(fs.readFileSync("mf.pdf")), 1.0);
  const [x0,y0,x1,y1] = g.bbox;
  const B = 900, s = B/(x1-x0), H = Math.round((y1-y0)*s);
  const navn: string[] = [];
  g.lag.forEach((l, i) => {
    const c = createCanvas(B, H); const ctx: any = c.getContext("2d");
    ctx.fillStyle = "#DDDDDD"; ctx.fillRect(0,0,B,H);
    ctx.fillStyle = l.hex === "#FFFFFF" ? "#FF00AA" : l.hex;   // hvit vises i rosa
    ctx.beginPath();
    for (const p of l.flate) for (const r of p) {
      if (r.length < 3) continue;
      ctx.moveTo((r[0][0]-x0)*s, H-(r[0][1]-y0)*s);
      for (let k=1;k<r.length;k++) ctx.lineTo((r[k][0]-x0)*s, H-(r[k][1]-y0)*s);
      ctx.closePath();
    }
    ctx.fill("evenodd");
    const fn = `/tmp/lag${i}.png`;
    fs.writeFileSync(fn, c.toBuffer("image/png"));
    navn.push(fn);
    console.log(`lag ${i}: ${l.hex} ${(l.andel*100).toFixed(1)} %  ${l.flate.length} flater, ${antallHull(l.flate)} hull`);
  });
  fs.writeFileSync("/tmp/laglist.txt", navn.join("\n"));
})();
