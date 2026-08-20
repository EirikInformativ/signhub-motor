import * as fs from "fs";
import { lesLett, tolk } from "../src/bilskisse.ts";
import { finnDekor } from "../src/dekorfinn.ts";
(async () => {
  const t0 = Date.now();
  const l = await lesLett(new Uint8Array(fs.readFileSync(process.argv[2] ?? "proace2.pdf")));
  const s = tolk(l);
  const malt = s.malt ?? s.malestokkTekst ?? 30;
  const f = finnDekor(l, malt, { L: s.lengdeM, B: s.breddeM, H: s.hoydeM });
  console.log(`malestokk 1:${malt.toFixed(2)}  L${s.lengdeM} B${s.breddeM} H${s.hoydeM}  (${Date.now() - t0} ms)`);
  console.log("\nVISNINGER");
  for (const v of f.visninger) console.log(`   ${v.navn.padEnd(10)} ${v.breddeEkteMm.toFixed(0)} x ${v.hoydeEkteMm.toFixed(0)} mm ekte`);
  console.log("\nDEKOR");
  for (const o of f.omraader) console.log(`   ${o.vis.padEnd(10)} ${o.navn.padEnd(8)} ${o.breddeEkteMm.toFixed(0)} x ${o.hoydeEkteMm.toFixed(0)} mm  ${o.bokser} flater  farger ${o.farger.length}`);
  console.log("\nFORKASTET");
  for (const k of f.forkastet) console.log(`   ${k.hva}: ${k.grunn}`);
  console.log("\nMERKNADER\n   " + f.merknader.join("\n   "));
})();
