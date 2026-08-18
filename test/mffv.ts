import * as fs from "fs";
import { createCanvas } from "@napi-rs/canvas";
import { forhandsvis } from "../src/forhandsvis";
const lag = (b: number, h: number) => createCanvas(Math.round(b), Math.round(h)) as any;
(async () => {
  const b = new Uint8Array(fs.readFileSync("mf.pdf"));
  const v = await forhandsvis(b, undefined, { bredde: 900 }, lag);
  fs.writeFileSync("/tmp/mf_fv.png", Buffer.from(v.bilde.split(",")[1], "base64"));
  console.log(`${v.bredde} x ${v.hoyde}`);
})();
