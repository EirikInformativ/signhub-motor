/**
 * Kia PV5 (310079): Pantone-dekor, sort ved siden av gronn, og bildeler
 * inne i rammen til store striper.
 *
 * Funnet 16.11.2026:
 *  - all dekor var PANTONE 7481 C via cs/scn, og motoren fant ingen dekor.
 *  - «ÅTG» kom ut som bare den gronne streken og trekanten; de sorte
 *    bokstavene og ringen i Å manglet.
 *  - stripene paa siden tok med doerhaandtak, vindu og bilens sorte
 *    kledning (graatoner og hvitt i fargelista).
 *  - «åtg.no» og «- RØR» bak (bare sort) kom ikke med.
 *
 *  - teksten, A-en og stripen ble ett element paa 2947 x 817 mm, nesten bare
 *    luft (Eirik: tekst og striper skal skjaeres hver for seg).
 *
 * Fasit: 10 elementer, ett meldt som samme merke (panseret). Bare gronn
 * og sort. ÅTG i 3 eksemplarer med sort over 75 %. A-en med trekant (2 stk),
 * stripen alene (2 stk), «RØR - ELEKTRO - ENERGI» for seg, og bak er
 * stripen, «åtg.no» og «- RØR» tre deler.
 */
import * as fs from "fs";
import { PDFDocument, decodePDFRawStream } from "pdf-lib";
import { lesBilskisse, kjorJobb, DISCLAIMER, VANNMERKE } from "../src/motor";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { hentBaner } from "../src/uttrekk";

(async () => {
  const bilder = { disclaimer: await loadImage(DISCLAIMER), vannmerke: await loadImage(VANNMERKE) } as any;
  const lerret = (b: number, h: number) => createCanvas(Math.round(b), Math.round(h)) as any;
  let feil = 0;
  const sjekk = (ok: boolean, t: string) => { console.log(`${ok ? "ok  " : "FEIL"} ${t}`); if (!ok) feil++; };
  const l = await lesBilskisse(new Uint8Array(fs.readFileSync("kia.pdf")), { jobb: "kia", bilder, lerret });
  const GRONN = "#00B528", SORT = "#000000";
  // sidene er ulike etter kuttet ved bildelene (speil og rute paa foerersiden), saa
  // stripen og A-en er ett element per side
  sjekk(l.elementer.length === 12, `12 elementer (fikk ${l.elementer.length})`);
  sjekk(l.elementer.filter((e) => e.sammeSom).length === 1, "panseret meldt som samme merke");
  const fremmed = l.elementer.filter((e) => e.farger.some((f) => f.hex !== GRONN && f.hex !== SORT));
  sjekk(!fremmed.length, `bare gronn og sort, ingen bildeler (${fremmed.map((e) => e.navn + ": " + e.farger.map((f) => f.hex).join(" ")).join("; ")})`);
  const atg = l.elementer.find((e) => e.antall === 3);
  const sortAndel = atg?.farger.find((f) => f.hex === SORT)?.andel ?? 0;
  sjekk(!!atg && sortAndel > 0.75, `ÅTG i 3 eksemplarer med sorte bokstaver og ring (sort ${(sortAndel * 100).toFixed(0)} %)`);
  const stor = l.elementer.filter((e) => e.breddeMm > 1000 && e.hoydeMm > 300);
  sjekk(!stor.length, `ingen store elementer med luft (${stor.map((e) => e.breddeMm + " x " + e.hoydeMm).join(", ")})`);
  const striper = l.elementer.filter((e) => e.breddeMm > 2000 && e.hoydeMm < 150);
  sjekk(striper.length === 2 && striper.every((e) => e.farger.length === 1), "den lange stripen er egen del paa hver side, bare gronn");
  // kuttet 50 mm forbi det som synes: hjulbuene skjuler endene (2570 mm foer)
  sjekk(striper.every((e) => e.breddeMm < 2400), `stripene er kuttet ved hjulbuene (${striper.map((e) => e.breddeMm).join(", ")} mm)`);
  const aer = l.elementer.filter((e) => e.hoydeMm > 500 && e.farger.length === 2 && /side/.test(e.vis));
  sjekk(aer.length === 2 && aer.every((e) => e.hoydeMm < 679), `A-en med gronn trekant er egen del paa hver side, kuttet under rute og speil (${aer.map((e) => e.hoydeMm).join(", ")} mm hoy)`);
  sjekk(l.merknader.filter((m) => /inn under bilens egne deler og er kuttet 50 mm/.test(m)).length === 2, "kuttet ved bildelene meldes for begge sidene");
  const tekst = l.elementer.filter((e) => e.breddeMm > 1150 && e.breddeMm < 1300 && e.farger.length === 1 && e.farger[0].hex === SORT);
  sjekk(tekst.length === 2, `«RØR - ELEKTRO - ENERGI» for seg paa begge sider (${tekst.length})`);
  const bakSort = l.elementer.filter((e) => /ende hoyre dekor 2 del/.test(e.navn) && e.farger[0].hex === SORT);
  sjekk(bakSort.length === 2, `bak: «åtg.no» og «- RØR» hver for seg (${bakSort.length})`);
  // hele jobben: stripen skjoetes etter rullbredden, og arkene blir korte.
  // For delingen og skjoetingen var begge arkene 5,9 m (11,9 m folie).
  const KART: Record<string, any> = { [GRONN]: { kode: "751-068", hex: GRONN, breddeMm: 1260 }, [SORT]: { kode: "751-070", hex: SORT, breddeMm: 1260 } };
  const r: any = await kjorJobb({ jobb: "kia", egenSkisse: false, linjer: l.elementer.filter((e) => !e.sammeSom)
    .map((e) => ({ navn: e.navn, pdf: e.pdf, breddeMm: e.breddeMm, antall: e.antall, folier: e.farger.map((f) => KART[f.hex]) })) } as any);
  const sum = r.ark.reduce((a: number, k: any) => a + k.lengdeMm, 0) / 1000;
  sjekk(r.advarsler.some((a: string) => /21\d\d mm lang stripe er skjoetet/.test(a)), "den lange stripen er skjoetet");
  sjekk(r.advarsler.some((a: string) => /1543 mm lang stripe er skjoetet i 2/.test(a)), "stripen bak er ogsaa skjoetet (i 2)");
  // tekstene skjoetes i mellomrommet mellom bokstavene, med 10 mm av neste
  // bokstav som passmerke. Det sorte tekstarket var 1273 mm langt.
  sjekk(r.advarsler.filter((a: string) => /12\d\d mm lang tekst er skjoetet i 2 stykker i mellomrommet/.test(a)).length === 2,
    "«RØR - ELEKTRO - ENERGI» skjoetes mellom bokstavene paa begge sider");
  const tekstark = r.ark.filter((a: any) => a.foliekode === "751-070").map((a: any) => a.lengdeMm);
  sjekk(Math.min(...tekstark) < 600, `det sorte tekstarket er kort (${tekstark.map((x: number) => x.toFixed(0)).join(", ")} mm)`);
  sjekk(sum < 4.6, `samlet folie under 4,6 m med formede rammer og skjoetede tekster (${sum.toFixed(2)} m)`);
  /**
   * Arket med bare hele stripestykker er bare thru-cut: elementet strekes i
   * Through, ingen ramme, ingen kiss, ingen regmarks.
   */
  const innhold = async (f: any) => {
    const d = await PDFDocument.load(f.bytes);
    const c: any = d.getPage(0).node.Contents();
    return new TextDecoder("latin1").decode(decodePDFRawStream(d.context.lookup(c) as any ?? c).decode());
  };
  const thru = r.filer.filter((f: any) => / Appliser\+thru 751-068 felt \d+x\d+ /.test(f.navn));
  sjekk(thru.length === 1, `stripestykkene i gront faar en egen fil med bare thru-cut (${r.filer.map((f: any) => f.navn).join(", ")})`);
  if (thru.length) {
    const t = await innhold(thru[0]);
    const maling = t.split("\n").filter((l) => /^(f|f\*|S|s|B|B\*|b|b\*)$/.test(l));
    sjekk(maling.length > 0 && maling.every((l) => l === "B*") && /\/CS0 CS/.test(t),
      `thru-fila har bare elementene, fylt og streket i Through: ingen regmarks, ramme eller kiss (${[...new Set(maling)].join(", ")})`);
  }
  // kiss-boksen uten fyll rundt hvert thru-cut-element skal staa (Eirik 16.11.2026)
  for (const f of r.filer.filter((f: any) => / Kiss\+thru /.test(f.navn))) {
    const t = await innhold(f);
    const kiss = t.slice(t.indexOf("/OC /L3 BDC"), t.indexOf("EMC", t.indexOf("/OC /L3 BDC")));
    const linjer = (kiss.match(/\nS\n/g) ?? []).length;
    sjekk(linjer > 3, `${f.navn}: kiss-boks rundt hvert thru-cut-element (${linjer} kiss-linjer)`);
  }

  // skraadde elementer rettes opp etter grunnlinjen: stripen, A-en (foettene),
  // teksten og ÅTG (den gronne streken i bunn)
  const rettet = l.merknader.filter((m) => /rettet opp/.test(m)).map((m) => m.split(":")[0]);
  for (const navn of ["side ovre dekor 2 del 1", "side ovre dekor 2 del 2", "side ovre dekor 2 del 3", "side ovre dekor 1"])
    sjekk(rettet.includes(navn), `${navn} rettet opp etter grunnlinjen`);

  // kundeskissen viser bilen slik den blir: klippebanene foelger med banene
  const { baner } = await hentBaner(new Uint8Array(fs.readFileSync("kia.pdf")));
  sjekk(baner.some((b) => b.klipp?.length), `klippebaner foelger med til kundeskissen (${baner.filter((b) => b.klipp?.length).length} baner)`);
  // vindusrutene er gradienter (sh) i DeviceN [/Black], klippet til ruten.
  // Uten dem ble rutene hvite paa foerersiden.
  const gr = baner.filter((b) => b.gradient);
  sjekk(gr.length >= 4, `vindusrutene leses som gradienter (${gr.length})`);
  sjekk(gr.every((b) => {
    const f = b.gradient!.farger; const a = f[0], z = f[f.length - 1];
    return Math.abs(a[0] - z[0]) > 0.5 && f.every((c) => Math.abs(c[0] - c[1]) < 0.02 && Math.abs(c[1] - c[2]) < 0.02);
  }), "gradientene gaar fra hvitt til sort i graatoner (prosess-sort, ikke reservefarge)");
  const elBaner = l.elementer.length;
  sjekk(elBaner === 12 && l.elementer.every((e: any) => !e.farger.some((f: any) => !/^#(00B528|000000)$/i.test(f.hex))),
    "ingen gradient havner i et element");

  if (feil) { console.log(`\n${feil} feil`); process.exit(1); }
  console.log("\nok: Kia PV5 leses riktig");
})();
