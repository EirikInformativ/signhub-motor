import * as fs from "fs";
import { createCanvas } from "@napi-rs/canvas";
import { forhandsvis } from "../src/forhandsvis";
const lag = (b: number, h: number) => createCanvas(Math.round(b), Math.round(h)) as any;
(async () => {
  const inf = new Uint8Array(fs.readFileSync("/home/claude/Informativ_logo_rod_prikk.pdf"));
  const a = await forhandsvis(inf, ["#1A1A1A", "#E30613"], { bredde: 520 }, lag);
  fs.writeFileSync("fv_valgt.png", Buffer.from(a.bilde.split(",")[1], "base64"));
  const b = await forhandsvis(inf, ["#FFFFFF", "#F2E200"], { bredde: 520 }, lag);
  fs.writeFileSync("fv_lys.png", Buffer.from(b.bilde.split(",")[1], "base64"));
  const c = await forhandsvis(inf, ["#1A1A1A", null], { bredde: 520 }, lag);
  fs.writeFileSync("fv_ensfarget.png", Buffer.from(c.bilde.split(",")[1], "base64"));
  const d = await forhandsvis(new Uint8Array(fs.readFileSync("/home/claude/kunde/Truck_Agent_Bergen.pdf")), undefined, { bredde: 520 }, lag);
  fs.writeFileSync("fv_truck.png", Buffer.from(d.bilde.split(",")[1], "base64"));
  console.log(`valgt ${a.bredde}x${a.hoyde} gra=${a.graaBunn} | lys gra=${b.graaBunn} | truck ${d.bredde}x${d.hoyde}`);
})();
