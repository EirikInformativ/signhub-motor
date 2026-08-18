import * as fs from "fs";
import { createCanvas } from "@napi-rs/canvas";
import { kjorJobb } from "../src/motor";
import { hentGeometriPerFarge } from "../src/pdfbaner";
// tegn lagene slik de faktisk vil ligge oppa hverandre pa bilen
(async () => {
  const pdf = new Uint8Array(fs.readFileSync("mf.pdf"));
  const g = await hentGeometriPerFarge(pdf, 1.0);
  const [x0,y0,x1,y1] = g.bbox; const B=1100, s=B/(x1-x0), H=Math.round((y1-y0)*s);
  // motoren sine lag, via samme regler
  const { forhandsvis } = await import("../src/forhandsvis");
  const v = await forhandsvis(pdf, ["#BE19FF","#FFFFFF","#1A1A1A"], { bredde: B },
    (b:number,h:number)=>createCanvas(Math.round(b),Math.round(h)) as any);
  fs.writeFileSync("/tmp/stabel.png", Buffer.from(v.bilde.split(",")[1], "base64"));
  console.log("ok", v.bredde, v.hoyde);
})();
