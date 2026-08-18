import * as fs from "fs";
import { createCanvas } from "@napi-rs/canvas";
import { forhandsvis } from "../src/forhandsvis";
const lag = (b: number, h: number) => createCanvas(Math.round(b), Math.round(h)) as any;
(async () => {
  const inf = new Uint8Array(fs.readFileSync("/home/claude/Informativ_logo_rod_prikk.pdf"));
  const saker: [string, any][] = [
    ["ingen farger oppgitt", undefined],
    ["tomme verdier (udefinert)", [undefined, undefined]],
    ["tom streng", ["", ""]],
    ["én valgt, én ikke", ["#C9A227", undefined]],
    ["begge valgt", ["#C9A227", "#1BB8B0"]],
    ["én slått av", ["#C9A227", null]],
  ];
  for (const [navn, f] of saker) {
    const v = await forhandsvis(inf, f, { bredde: 300 }, lag);
    fs.writeFileSync("fv_" + navn.replace(/[^a-z]/gi, "") + ".png", Buffer.from(v.bilde.split(",")[1], "base64"));
    console.log(`${navn.padEnd(28)} ok`);
  }
})();
