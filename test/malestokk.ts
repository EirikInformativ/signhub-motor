/**
 * Malestokken skal leses, ikke regnes ut.
 *
 * Maalingen kan aldri treffe eksakt: CCVision sin egen tegning stemmer
 * ikke eksakt med CCVision sitt eget oppgitte lengdemaal. Arket sier 1:30
 * og L 5.309 m, men raadataen ganget opp 3000 prosent gir 5322,325 mm,
 * altsa 13 mm mer. Utledes malestokken av L, B og H, sammenlignes en
 * tegning mot et tall som ikke beskriver den tegningen presist, og
 * avviket kan aldri bli null. Paa proace2 ble alt 0,365 prosent for lite.
 *
 * Staar det en malestokk paa arket, er den fasit. Maalingen beholdes som
 * vakthund.
 */
import * as fs from "fs";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { lesLett, tolk } from "../src/bilskisse";
import type { LettLest } from "../src/bilskisse";
import { lesBilskisse, DISCLAIMER, VANNMERKE } from "../src/motor";

const MM = 72 / 25.4;
let feil = 0;
const sjekk = (navn: string, ok: boolean, detalj = "") => {
  console.log(`   ${ok ? "ok  " : "FEIL"}  ${navn}${detalj ? "  — " + detalj : ""}`);
  if (!ok) feil++;
};

/**
 * Et konstruert ark: en sidevisning av en bil paa L x H, tegnet i den
 * malestokken vi ber om, med maalene og malestokkteksten paa arket.
 * Alt gaar gjennom den ekte tolk(), ogsaa selve maalingen.
 */
const ark = (tekstMalestokk: string, tegnetI: number): LettLest => {
  const L = 5.309, B = 1.92, H = 1.94;
  const b = ((L * 1000) / tegnetI) * MM;
  const h = ((H * 1000) / tegnetI) * MM;
  return {
    tekst: `Toyota Proace  ${tekstMalestokk}  L: ${L}  B: ${B}  H: ${H}`,
    bokser: [{ x0: 0, y0: 0, x1: b, y1: h }],
    side: { x0: 0, y0: 0, x1: b + 100, y1: h + 100 },
  };
};

(async () => {
  console.log("1. proace2: den trykte malestokken er fasit");

  const bytes = new Uint8Array(fs.readFileSync("proace2.pdf"));
  const s = tolk(await lesLett(bytes));

  sjekk("malestokk 30,0000", s.malestokk === 30, `${s.malestokk?.toFixed(4)}`);
  sjekk("avvik 0", s.avvikProsent === 0, `${s.avvikProsent}`);
  sjekk("malingen er beholdt som vakthund",
    !!s.malt && Math.abs(s.malt - 29.8904) < 0.001, `malt 1:${s.malt?.toFixed(4)}`);
  sjekk("ingen merknad om malestokken naar den stemmer",
    !s.merknader.some((m) => /malestokk/i.test(m)),
    s.merknader.filter((m) => /malestokk/i.test(m)).join(" | ") || "ingen");

  const bilder = {
    disclaimer: await loadImage(DISCLAIMER),
    vannmerke: await loadImage(VANNMERKE),
  } as any;
  const lest = await lesBilskisse(bytes, {
    jobb: "Rosen", bilder,
    lerret: (b: number, h: number) => createCanvas(Math.round(b), Math.round(h)) as any,
  });
  const side = lest.elementer.find((e) => /side ovre/.test(e.navn));

  /**
   * 1232, ikke 1233. De 1233 kommer av aa gange den allerede avrundede
   * 1228 opp med 30/29,8904. Den eksakte kjeden er 41,0785 mm tegnet
   * ganger 30 = 1232,355. Maalt med den gamle malestokken ble det
   * 1227,855, altsa 1228. Rettelsen er 4,5 mm, ikke 5.
   */
  sjekk("sidelogoen 1232 mm, ikke 1228", side?.breddeMm === 1232,
    `${side?.breddeMm} mm (var 1228 med utledet malestokk)`);
  sjekk("lest.malestokk er den trykte", lest.malestokk === 30, `${lest.malestokk}`);
  sjekk("lest.avvikProsent er 0", lest.avvikProsent === 0, `${lest.avvikProsent}`);

  console.log("\n2. konstruert ark, tegnet i 1:30 med teksten 1:30");

  const rett = tolk(ark("1:30", 30));
  sjekk("bruker den trykte", rett.malestokk === 30, `${rett.malestokk?.toFixed(4)}`);
  sjekk("avvik 0", rett.avvikProsent === 0);

  console.log("\n3. konstruert ark skalert 1000 prosent, teksten sier fortsatt 1:30");

  const skalert = tolk(ark("1:30", 3));
  sjekk("bruker den malte", skalert.malestokk !== null &&
    Math.abs(skalert.malestokk - 3) < 0.01, `1:${skalert.malestokk?.toFixed(3)}`);
  sjekk("melder at arket er skalert 1000 prosent",
    skalert.merknader.some((m) => /skalert 1000 prosent/.test(m)),
    skalert.merknader.find((m) => /skalert/.test(m))?.slice(0, 80) ?? "ingen merknad");
  sjekk("avviket er meldt, ikke nullstilt",
    !!skalert.avvikProsent && Math.abs(skalert.avvikProsent) > 3,
    `${skalert.avvikProsent?.toFixed(1)} %`);

  console.log("\n4. konstruert ark med tull: verken samme eller rent skalert");

  // tegnet i 1:12,7 mens teksten sier 1:30. Forholdet 2,36 er ikke et rent tall.
  const tull = tolk(ark("1:30", 12.7));
  sjekk("bruker ingen malestokk", tull.malestokk === null, `${tull.malestokk}`);
  sjekk("melder at skissen ikke er til a stole pa",
    tull.merknader.some((m) => /ikke til a stole pa/.test(m)),
    tull.merknader.find((m) => /stole/.test(m))?.slice(0, 80) ?? "ingen merknad");

  // lesBilskisse kaster naar malestokk er null, med teksten fra begge kilder
  console.log("\n5. ingen trykt malestokk: den malte brukes, med merknad");

  const uten = tolk({ ...ark("", 30), tekst: "Toyota Proace  L: 5.309  B: 1.92  H: 1.94" });
  sjekk("bruker den malte", uten.malestokk !== null &&
    Math.abs(uten.malestokk - 30) < 0.01, `1:${uten.malestokk?.toFixed(3)}`);
  sjekk("melder at den er utledet",
    uten.merknader.some((m) => /utledet/.test(m)),
    uten.merknader.find((m) => /utledet/.test(m))?.slice(0, 70) ?? "ingen merknad");

  console.log(feil === 0 ? "\nok: den trykte malestokken er fasit, malingen er vakthund"
                         : `\nFEIL: ${feil} sjekker feilet`);
  if (feil) process.exit(1);
})();
