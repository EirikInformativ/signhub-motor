/**
 * To skisser som ble lest feil 16.11.2026 (natt), og reglene som retter dem.
 *
 * 306005 E-Partner (LTS Maskin, sort Peugeot Partner):
 *  - tegningen er skalert til 93 prosent (1:32,4) mens teksten sier 1:30.
 *    To maal som stoetter hverandre innenfor 1 prosent er til aa stole paa.
 *  - kontaktteksten («56 39 12 00») ble delt i ord fordi korte ord fikk
 *    tilfeldig retning; korte ord har ingen sikker retning.
 *  - den hvite teksten under den flerfargede logoen skilles ut, saa
 *    logoen kan printes og teksten skjaeres i 010 (Eirik), med vannrett
 *    passmerke mellom dem.
 *  - nummerskiltet (hvitt med sort kant) er bil.
 *
 * 304160 Vito (Østerbo, moerkeblaa Mercedes Vito):
 *  - arket er skalert 1200 prosent; tegnede avstander skaleres med.
 *  - lakken er blaa: den kuloeren som dekker mest er bilen, og da er bilen
 *    moerk og hvitt er dekor.
 *  - bilens tegnelinjer er strek uten fyll og er ikke hvit dekor.
 *  - den store Ø-en paa venstre side er klippet (W n); en ekstra Ø laa
 *    klippet helt bort. Klippet teller, og dekoren kuttes 50 mm forbi det.
 *  - fotoene paa sidene er innsatte bilder og meldes.
 */
import * as fs from "fs";
import { lesBilskisse, DISCLAIMER, VANNMERKE } from "../src/motor";
import { createCanvas, loadImage } from "@napi-rs/canvas";

(async () => {
  const bilder = { disclaimer: await loadImage(DISCLAIMER), vannmerke: await loadImage(VANNMERKE) } as any;
  const lerret = (b: number, h: number) => createCanvas(Math.round(b), Math.round(h)) as any;
  let feil = 0;
  const sjekk = (ok: boolean, tekst: string) => { console.log(`${ok ? "ok  " : "FEIL"} ${tekst}`); if (!ok) feil++; };

  const ep: any = await lesBilskisse(new Uint8Array(fs.readFileSync("ep306005.pdf")), { jobb: "ep", bilder, lerret } as any);
  // Eirik 17.11.2026: sidelogoen er 1739,683 mm i hans printfil. Den trykte 1:30 er fasit.
  sjekk(ep.malestokk === 30, `E-Partner: trykt malestokk 1:30 brukes (${ep.malestokk.toFixed(2)})`);
  const sidelogo = ep.elementer.find((e: any) => e.vis === "side" && e.farger.length > 1);
  sjekk(sidelogo && Math.abs(sidelogo.breddeMm - 1739.7) < 5, `E-Partner: sidelogoen 1739,7 mm (${sidelogo?.breddeMm})`);
  sjekk(sidelogo?.farger.some((f: any) => f.hex === "#A6A6A6"), "E-Partner: den graa ruten bak haken er med");
  const flerfarget = ep.elementer.filter((e: any) => e.farger.length > 1);
  sjekk(flerfarget.length === 3, `E-Partner: tre logoer i blaatt og roedt (${flerfarget.length})`);
  const tekster = ep.elementer.filter((e: any) => e.farger.length === 1 && e.farger[0].hex === "#FFFFFF");
  sjekk(tekster.some((e: any) => e.breddeMm > 1700 && e.hoydeMm < 120), "E-Partner: teksten under sidelogoen er eget element");
  sjekk(tekster.some((e: any) => Math.abs(e.breddeMm - 612) < 20 && Math.abs(e.hoydeMm - 216) < 20), "E-Partner: kontaktteksten paa siden er ett element");
  sjekk(ep.logg.filter((m: string) => /foerste og siste hoeye tegn/.test(m)).length >= 3, "E-Partner: passmerke av foerste og siste hoeye tegn mellom logo og tekst");
  sjekk(!ep.logg.some((m: string) => /strimmel/.test(m)), "E-Partner: ingen strimmel som passmerke for utskilt tekst");
  const sideEl = ep.elementer.filter((e: any) => e.vis === "side");
  sjekk(sideEl.length >= 3 && sideEl.every((e: any) => e.antall === 2 && e.ensidig && !e.ensidig.speilet),
    "E-Partner: bare én side tegnet, tekst og logo paa siden telles to ganger uten speilvending");
  sjekk(!ep.elementer.some((e: any) => e.vis !== "side" && e.ensidig), "E-Partner: front, bak og topp dupliseres ikke");
  sjekk(!ep.elementer.some((e: any) => e.breddeMm > 470 && e.breddeMm < 600 && e.hoydeMm > 90 && e.hoydeMm < 140), "E-Partner: nummerskiltene er ikke dekor");

  const v: any = await lesBilskisse(new Uint8Array(fs.readFileSync("vito304160.pdf")), { jobb: "v", bilder, lerret } as any);
  sjekk(Math.abs(v.malestokk - 2.5) < 0.05, `Vito 304160: arket er skalert 1200 prosent, 1:2,5 (${v.malestokk.toFixed(2)})`);
  sjekk(v.elementer.every((e: any) => !e.farger.some((f: any) => f.hex === "#000000")), "Vito 304160: ingen sorte bildeler (tegnelinjer) som dekor");
  const ø = v.elementer.filter((e: any) => e.breddeMm > 800 && e.hoydeMm > 1000);
  sjekk(ø.length === 2, `Vito 304160: én stor Ø paa hver side (${ø.map((e: any) => Math.round(e.breddeMm) + "x" + Math.round(e.hoydeMm)).join(", ")})`);
  sjekk(ø.every((e: any) => e.hoydeMm < 1200), "Vito 304160: Ø-ene er kuttet ved klippet, ikke doble");
  sjekk(v.merknader.some((m: string) => /innsatte bilder/.test(m)), "Vito 304160: fotoene paa sidene er meldt");
  sjekk(v.elementer.filter((e: any) => e.farger.every((f: any) => f.hex === "#FFFFFF")).length >= 10, "Vito 304160: den hvite dekoren er funnet");

  // Vito i sort (Skisse_Vito_rev_3): fasiten fra kvelden 16.11 skal staa
  const s: any = await lesBilskisse(new Uint8Array(fs.readFileSync("vito_sort.pdf")), { jobb: "s", bilder, lerret } as any);
  const mal = (e: any) => `${Math.round(e.breddeMm)}x${Math.round(e.hoydeMm)}`;
  const har = (b: number, h: number) => s.elementer.some((e: any) => Math.abs(e.breddeMm - b) < 15 && Math.abs(e.hoydeMm - h) < 15);
  sjekk(har(542, 965) && har(480, 128) && har(1119, 260) && har(542, 154), `Vito sort: de fire elementene bak (${s.elementer.filter((e: any) => /^ende hoyre/.test(e.navn)).map(mal).join(", ")})`);
  sjekk(har(2040, 465) && har(765, 217), "Vito sort: logoen paa siden uten sifre fra telefonnummeret, og «24 timers service» for seg");
  // skiltet var 525 x 109 i hvitt med sort kant (ikke «24 timers service», 480 x 128)
  sjekk(!har(525, 109), "Vito sort: nummerskiltet er ikke dekor");

  console.log(feil ? `\nFEIL: ${feil} sjekker feilet` : "\nok: lakkert bil og skalert ark leses riktig");
  process.exit(feil ? 1 : 0);
})();
