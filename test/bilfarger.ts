/**
 * Bilens egne deler skal ikke leses som dekor, og en svart flate i en logo
 * paa en hvit bil er dekor, ikke lakk.
 *
 * Funnet 16.11.2026 paa 309916 e-expert (Peugeot e-Expert, XL-BYGG):
 *  - baklykter og refleks (CMYK 0,1,1,0.15) ble lest som dekor fordi
 *    skissen ikke hadde harstrek i lyktefargen. Lyktefargen fanget i
 *    tillegg hjul, takrails og hele taket inn i klyngene.
 *  - dekket paa bakhjulet, i rik sort med K-graatt rundt, ble eget element.
 *  - den svarte firkanten i XL-logoen ble tatt som bakgrunnsplate og
 *    fjernet, saa bare gull ville blitt skaaret.
 *
 * Fasit: 11 elementer, ingen over 1300 mm, ingen med K-graatoner, og
 * XL-boksene har baade gull og sort. proace2 skal fortsatt gi fire
 * elementer med hvit plate tatt ut.
 */
import * as fs from "fs";
import { lesBilskisse, DISCLAIMER, VANNMERKE } from "../src/motor";
import { createCanvas, loadImage } from "@napi-rs/canvas";

(async () => {
  const bilder = { disclaimer: await loadImage(DISCLAIMER), vannmerke: await loadImage(VANNMERKE) } as any;
  const lerret = (b: number, h: number) => createCanvas(Math.round(b), Math.round(h)) as any;
  let feil = 0;
  const sjekk = (ok: boolean, tekst: string) => { console.log(`${ok ? "ok  " : "FEIL"} ${tekst}`); if (!ok) feil++; };

  const e = await lesBilskisse(new Uint8Array(fs.readFileSync("eexpert.pdf")), { jobb: "e-expert", bilder, lerret });
  sjekk(e.elementer.length === 10, `e-expert: 10 elementer (panseret forfra er utelatt) (fikk ${e.elementer.length})`);
  const stor = e.elementer.filter((x) => Math.max(x.breddeMm, x.hoydeMm) > 1300);
  sjekk(!stor.length, `e-expert: ingen element over 1300 mm (tak, rails) ${stor.map((x) => x.navn).join(", ")}`);
  const graa = e.elementer.filter((x) => x.farger.some((f) => ["#404040", "#8C8C8C", "#D9D9D9"].includes(f.hex)));
  sjekk(!graa.length, `e-expert: ingen element i bilens graatoner (hjul) ${graa.map((x) => x.navn).join(", ")}`);
  const xl = e.elementer.filter((x) => x.breddeMm > 700 && x.breddeMm < 800 || x.breddeMm > 700 && x.hoydeMm > 440 && x.hoydeMm < 500);
  sjekk(xl.length === 2 && xl.every((x) => x.farger.length === 2 && !x.bakgrunn),
    `e-expert: XL-boksene beholder den svarte firkanten (${xl.map((x) => x.farger.map((f) => f.hex).join("+")).join(", ")})`);
  sjekk(![...e.merknader, ...e.logg].some((m: string) => /er tatt ut/.test(m)), "e-expert: ingen plate tatt ut");

  const p = await lesBilskisse(new Uint8Array(fs.readFileSync("proace2.pdf")), { jobb: "proace", bilder, lerret });
  sjekk(p.elementer.length === 4, `proace2: 4 elementer (fikk ${p.elementer.length})`);
  sjekk(p.elementer.every((x) => x.bakgrunn?.hex === "#FFFFFF"), "proace2: hvit plate tatt ut paa alle");

  {
    // Rydd Bergen (Fiat Ducato, gul lakk, 17.11.2026): bilens tonede graa,
    // rik sort paa dekk og listverk, og baklyktene (0.21,1,0.98,0.16) er bil
    const rb: any = await lesBilskisse(new Uint8Array(fs.readFileSync("ryddbergen.pdf")), { jobb: "rb", bilder, lerret } as any);
    sjekk(rb.elementer.every((e: any) => e.farger.every((f: any) => /^#(FF0000|000000)$/.test(f.hex))),
      `Rydd Bergen: bare roedt og sort i dekoren (${[...new Set(rb.elementer.flatMap((e: any) => e.farger.map((f: any) => f.hex)))].join(", ")})`);
    sjekk(!rb.elementer.some((e: any) => Math.abs(e.breddeMm - 717) < 20 && Math.abs(e.hoydeMm - 717) < 20), "Rydd Bergen: hjulene er ikke dekor");
    sjekk(rb.elementer.length <= 9, `Rydd Bergen: bare logoene og bilfiguren (${rb.elementer.length} elementer)`);
    sjekk(rb.merknader.some((m: string) => /levende tekst/.test(m)), "Rydd Bergen: tekst som ikke er konvertert meldes");
  }
  if (feil) { console.log(`\n${feil} feil`); process.exit(1); }
  console.log("\nok: bilen er bilen, logoen er logoen");
})();
