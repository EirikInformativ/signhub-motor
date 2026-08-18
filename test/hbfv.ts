import * as fs from "fs";
import { createCanvas } from "@napi-rs/canvas";
import { forhandsvis } from "../src/forhandsvis";
const lag = (b: number, h: number) => createCanvas(Math.round(b), Math.round(h)) as any;
(async () => {
  const b = new Uint8Array(fs.readFileSync("hb.ai"));
  const saker: [string, any][] = [
    ["filens egne farger", undefined],
    ["ingen folie valgt enna", [undefined, undefined]],
    ["gull og turkis valgt", ["#28A6B0", "#B69D73"]],
    ["gull slatt av", ["#28A6B0", null]],
  ];
  const ut: string[] = [];
  for (const [navn, f] of saker) {
    const v = await forhandsvis(b, f, { bredde: 460 }, lag);
    const fn = "hb_" + navn.replace(/[^a-z]/gi, "") + ".png";
    fs.writeFileSync(fn, Buffer.from(v.bilde.split(",")[1], "base64"));
    ut.push(fn);
    console.log(navn.padEnd(26), "ok");
  }
  fs.writeFileSync("hb_liste.txt", ut.join("\n"));
})();
