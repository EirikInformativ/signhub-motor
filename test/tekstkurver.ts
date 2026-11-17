/**
 * Levende tekst i en bilskisse gjoeres om til kurver naar fonten er innebygd.
 *
 * 309916 e-expert: «XL-BYGG Osteroy» og telefonnummeret staar tre steder.
 * Paa side nedre er teksten konvertert til kurver av designeren. Paa side
 * ovre og paa bakluken (ende hoyre) er den levende tekst i HelveticaNeue
 * (Type 1C, CFF), og kom foer ikke med i skjaerefilene.
 *
 * Fasit:
 *  - alle tre kommer med som elementer. Side ovre er samme element som side
 *    nedre (samme antall baner, samme bredde), altsaa antall 2, 512 x 122 mm.
 *    Bakluken er 372 x 88 mm, med teksten i samme forhold til pinnen.
 *  - hver konvertert bokstav paa side ovre treffer kurveutgaven paa side
 *    nedre innenfor 0,5 mm i ekte maal (1:30), i stoerrelse og plassering
 *    i forhold til teksten.
 *  - ingen merknad om levende tekst, og én linje i logg (ikke merknader)
 *    om at fire tekstlinjer er gjort om til kurver.
 *  - arkets egen tekst staar igjen: malestokken 1:30 leses som foer.
 *  - kan fonten ikke leses, staar teksten som levende tekst og meldes som
 *    foer, uten at noe kastes ut til brukeren.
 *  - usynlig tekst (Tr 3) gjoeres ikke om.
 *  - den nyere utgaven av skissen (eexpert2.pdf) gir det samme.
 */
import * as fs from "fs";
import { PDFDocument, PDFName, PDFDict, PDFRawStream, decodePDFRawStream } from "pdf-lib";
import { lesBilskisse, DISCLAIMER, VANNMERKE } from "../src/motor";
import { finnTekst, tekstTilKurver } from "../src/tekstkurver";
import { hentBaner } from "../src/uttrekk";
import type { Bane } from "../src/uttrekk";
import { createCanvas, loadImage } from "@napi-rs/canvas";

const MM = 72 / 25.4;
const EKTE = 30 / MM; // punkt paa arket til ekte mm ved 1:30
const TEKSTFARGE = "0.71,0.65,0.64,0.71";
const fk = (f: number[]) => f.map((v) => v.toFixed(2)).join(",");

(async () => {
  let feil = 0;
  const sjekk = (ok: boolean, t: string) => { console.log(`${ok ? "ok  " : "FEIL"} ${t}`); if (!ok) feil++; };
  const bilder = { disclaimer: await loadImage(DISCLAIMER), vannmerke: await loadImage(VANNMERKE) } as any;
  const lerret = (b: number, h: number) => createCanvas(Math.round(b), Math.round(h)) as any;
  const original = new Uint8Array(fs.readFileSync("eexpert.pdf"));

  /* ---------- hele lesBilskisse ---------- */
  for (const fil of ["eexpert.pdf", "eexpert2.pdf"]) {
    const lest = await lesBilskisse(new Uint8Array(fs.readFileSync(fil)), { jobb: "x", bilder, lerret });
    sjekk(lest.malestokk === 30 && lest.malestokkTekst === 30, `${fil}: arkets tekst staar igjen, malestokken leses som 1:30 (fikk 1:${lest.malestokk})`);
    const farger = (e: any) => e.farger.map((f: any) => f.hex).sort().join(",");
    const side = lest.elementer.find((e) => e.breddeMm === 512 && e.hoydeMm === 122);
    sjekk(!!side && side.antall === 2 && /side ovre/.test(side.navn) && /side nedre/.test(side.navn) &&
      farger(side) === "#000000,#D7C46D",
      `${fil}: side ovre (konvertert) er samme element som side nedre (kurver): ${side?.navn} ${side?.breddeMm} x ${side?.hoydeMm}, antall ${side?.antall}`);
    const ende = lest.elementer.find((e) => /ende hoyre/.test(e.navn) && farger(e) === "#000000,#D7C46D" && e.hoydeMm < 100);
    sjekk(!!ende && Math.abs(ende.breddeMm - 372) <= 1 && Math.abs(ende.hoydeMm - 88) <= 1,
      `${fil}: bakluken har teksten med pinnen: ${ende?.navn} ${ende?.breddeMm} x ${ende?.hoydeMm} (fasit 372 x 88)`);
    sjekk(!lest.merknader.some((m) => /levende tekst/.test(m)), `${fil}: ingen merknad om levende tekst`);
    sjekk(lest.levendeTekst.length === 0, `${fil}: levendeTekst er tom (${lest.levendeTekst.length})`);
    sjekk(lest.logg.some((l) => /^4 tekstlinjer i visningene .* gjort om til kurver.*XL-BYGG Osterøy/.test(l)),
      `${fil}: logg sier at fire tekstlinjer er gjort om til kurver`);
    sjekk(!lest.merknader.some((m) => /kurver fra fonten/.test(m)), `${fil}: konverteringen staar i logg, ikke i merknader`);
  }

  /* ---------- bokstav for bokstav mot kurveutgaven ---------- */
  const vis = await finnTekst(original);
  const xl = vis.filter((t) => fk(t.farge) === TEKSTFARGE && t.tekst.trim());
  sjekk(xl.length === 26 && xl.every((t) => t.kan), `finnTekst: 26 tekstvisninger i XL-BYGG-teksten, alle kan gjoeres om (${xl.length})`);
  sjekk(vis.some((t) => /1:30/.test(t.tekst)), "finnTekst: arkets malestokk er tekst");
  const r = await tekstTilKurver(original, new Set(xl.map((t) => t.id)));
  sjekk(r.gjort.length === xl.length, `tekstTilKurver: alle ${xl.length} gjort om (${r.gjort.length})`);
  const etter = await finnTekst(r.pdf);
  sjekk(!etter.some((t) => fk(t.farge) === TEKSTFARGE && t.tekst.trim()), "tekstTilKurver: ingen XL-BYGG-tekst igjen som tekst");
  sjekk(etter.some((t) => /1:30/.test(t.tekst)), "tekstTilKurver: arkets malestokk er fortsatt tekst");

  const { baner } = await hentBaner(r.pdf);
  const glyfer = baner.filter((b) => b.fyll && fk(b.farge) === TEKSTFARGE);
  // tre grupper: bakluken, side ovre (konvertert) og side nedre (kurver fra designeren)
  // samme rike sort brukes ogsaa andre steder paa bilen; tekstene er klyngene paa 26 bokstaver
  const alle: Bane[][] = [];
  for (const b of [...glyfer].sort((a, c) => a.boks.x0 - c.boks.x0)) {
    const g = alle.find((gg) => gg.some((x) => Math.hypot(
      Math.max(0, x.boks.x0 - b.boks.x1, b.boks.x0 - x.boks.x1), Math.max(0, x.boks.y0 - b.boks.y1, b.boks.y0 - x.boks.y1)) < 10));
    if (g) g.push(b); else alle.push([b]);
  }
  const grupper = alle.filter((g) => g.length === 26);
  sjekk(grupper.length === 3, `tre steder med XL-BYGG-teksten, 26 bokstaver hvert sted (${grupper.length})`);
  const { baner: raa } = await hentBaner(original);
  const kurveSett = new Set(raa.filter((b) => b.fyll && fk(b.farge) === TEKSTFARGE).map((b) => `${b.boks.x0.toFixed(3)},${b.boks.y0.toFixed(3)}`));
  const erKurver = (g: Bane[]) => g.every((b) => kurveSett.has(`${b.boks.x0.toFixed(3)},${b.boks.y0.toFixed(3)}`));
  const fasit = grupper.find(erKurver);
  const konv = grupper.filter((g) => !erKurver(g));
  sjekk(!!fasit && konv.length === 2, "kurveutgaven (side nedre) er fasit, de to andre er konvertert");
  const ramme = (g: Bane[]) => ({ x0: Math.min(...g.map((b) => b.boks.x0)), y0: Math.min(...g.map((b) => b.boks.y0)),
    x1: Math.max(...g.map((b) => b.boks.x1)), y1: Math.max(...g.map((b) => b.boks.y1)) });
  const ordnet = (g: Bane[]) => {
    const rm = ramme(g), midt = (rm.y0 + rm.y1) / 2;
    return [...g].sort((a, b) => ((b.boks.y0 + b.boks.y1) / 2 > midt ? 1 : 0) - ((a.boks.y0 + a.boks.y1) / 2 > midt ? 1 : 0) ||
      a.boks.x0 - b.boks.x0);
  };
  if (fasit && konv.length === 2) {
    // side ovre: samme stoerrelse som fasit
    const fr = ramme(fasit);
    const ovre = konv.find((g) => Math.abs((ramme(g).x1 - ramme(g).x0) - (fr.x1 - fr.x0)) < 1)!;
    const or = ramme(ovre);
    const dB = Math.abs((or.x1 - or.x0) - (fr.x1 - fr.x0)) * EKTE, dH = Math.abs((or.y1 - or.y0) - (fr.y1 - fr.y0)) * EKTE;
    sjekk(!!ovre && dB < 0.5 && dH < 0.5,
      `side ovre: teksten ${((or.x1 - or.x0) * EKTE).toFixed(2)} x ${((or.y1 - or.y0) * EKTE).toFixed(2)} mm, ` +
      `fasit ${((fr.x1 - fr.x0) * EKTE).toFixed(2)} x ${((fr.y1 - fr.y0) * EKTE).toFixed(2)} mm (avvik ${dB.toFixed(2)} / ${dH.toFixed(2)} mm)`);
    // bokstav for bokstav: stoerrelse og plassering i forhold til teksten
    const a = ordnet(ovre), f = ordnet(fasit);
    let verst = 0, hvor = "";
    for (let i = 0; i < Math.min(a.length, f.length); i++) {
      const av = Math.max(
        Math.abs((a[i].boks.x0 - or.x0) - (f[i].boks.x0 - fr.x0)), Math.abs((a[i].boks.y0 - or.y0) - (f[i].boks.y0 - fr.y0)),
        Math.abs((a[i].boks.x1 - or.x0) - (f[i].boks.x1 - fr.x0)), Math.abs((a[i].boks.y1 - or.y0) - (f[i].boks.y1 - fr.y0))) * EKTE;
      if (av > verst) { verst = av; hvor = `bokstav ${i + 1}`; }
    }
    sjekk(verst < 0.5, `side ovre: hver bokstav treffer kurveutgaven, verste avvik ${verst.toFixed(3)} mm (${hvor})`);
    // oe-en (bokstav 14, siste i «Osteroy» foer y) er den som krever riktig koding
    const oe = 12; // X L - B Y G G O s t e r oe y: indeks 12
    const ao = a[oe].boks, fo = f[oe].boks;
    const oeAvvik = Math.max(Math.abs((ao.x1 - ao.x0) - (fo.x1 - fo.x0)), Math.abs((ao.y1 - ao.y0) - (fo.y1 - fo.y0))) * EKTE;
    sjekk(oeAvvik < 0.5 && (ao.y1 - ao.y0) > 0, `side ovre: ø er riktig glyf (avvik ${oeAvvik.toFixed(3)} mm, ` +
      `${((ao.x1 - ao.x0) * EKTE).toFixed(2)} x ${((ao.y1 - ao.y0) * EKTE).toFixed(2)} mm)`);
    // bakluken: samme tekst i mindre skala, samme forhold mellom bokstavene
    const ende = konv.find((g) => g !== ovre)!;
    const er = ramme(ende);
    const sk = (er.x1 - er.x0) / (fr.x1 - fr.x0);
    const e = ordnet(ende);
    let vEnde = 0;
    for (let i = 0; i < Math.min(e.length, f.length); i++) {
      vEnde = Math.max(vEnde, Math.abs((e[i].boks.x0 - er.x0) / sk - (f[i].boks.x0 - fr.x0)) * EKTE,
        Math.abs((e[i].boks.y0 - er.y0) / sk - (f[i].boks.y0 - fr.y0)) * EKTE);
    }
    sjekk(vEnde < 0.5, `bakluken: teksten er fasiten skalert ${(sk * 100).toFixed(1)} %, verste avvik ${vEnde.toFixed(3)} mm`);
  }

  /* ---------- fonten lar seg ikke lese: teksten meldes som foer ---------- */
  {
    const doc = await PDFDocument.load(original);
    let oedelagt = 0;
    for (const [, obj] of doc.context.enumerateIndirectObjects()) {
      if (!(obj instanceof PDFDict)) continue;
      if (String(obj.get(PDFName.of("Type"))) !== "/FontDescriptor") continue;
      for (const n of ["FontFile3", "FontFile2"]) if (obj.get(PDFName.of(n))) {
        obj.set(PDFName.of(n), doc.context.register(doc.context.stream(new Uint8Array([1, 0, 4, 1, 0, 0, 7, 7, 7]))));
        oedelagt++;
      }
    }
    const b = await doc.save();
    let kastet: any = null;
    let lest: any = null;
    try { lest = await lesBilskisse(b, { jobb: "x", bilder, lerret }); } catch (e) { kastet = e; }
    sjekk(!kastet, `uleselig font (${oedelagt} fontfiler oedelagt): ingen feil kastes (${kastet?.message ?? "ingen"})`);
    const meldt = (lest?.merknader ?? []).filter((m: string) => /XL-BYGG Osterøy.*er levende tekst og er IKKE med i skjaerefilene/.test(m));
    sjekk(meldt.length === 2, `uleselig font: «XL-BYGG Osteroy» meldes som levende tekst to steder (${meldt.length})`);
    sjekk(!(lest?.logg ?? []).some((l: string) => /gjort om til kurver/.test(l)), "uleselig font: ingenting meldes som gjort om");
    const tv = await finnTekst(b);
    const grunner = [...new Set(tv.filter((t) => !t.kan).map((t) => t.grunn))];
    sjekk(tv.length > 0 && tv.every((t) => !t.kan), `uleselig font: finnTekst sier at ingenting kan gjoeres om (${grunner.join(" | ")})`);
  }

  /* ---------- usynlig tekst (Tr 3) gjoeres ikke om ---------- */
  {
    const doc = await PDFDocument.load(original);
    const side: any = doc.getPage(0);
    const c: any = side.node.Contents();
    const raaS: any = c?.asArray ? doc.context.lookup(c.asArray()[0]) : c;
    const tekst = new TextDecoder("latin1").decode(raaS instanceof PDFRawStream ? decodePDFRawStream(raaS).decode() : raaS.getContents());
    const ny = tekst.replace("/T1_1 1 Tf", "/T1_1 1 Tf 3 Tr");
    sjekk(ny !== tekst, "Tr 3: satt inn foran den foerste XL-BYGG-teksten");
    const bytes = new Uint8Array(ny.length);
    for (let i = 0; i < ny.length; i++) bytes[i] = ny.charCodeAt(i) & 255;
    side.node.set(PDFName.of("Contents"), doc.context.register(doc.context.flateStream(bytes)));
    const b = await doc.save();
    const tv = await finnTekst(b);
    const usynlige = tv.filter((t) => t.usynlig && t.tekst.trim());
    sjekk(usynlige.length > 0 && usynlige.every((t) => !t.kan), `Tr 3: ${usynlige.length} usynlige tekstvisninger, ingen kan gjoeres om`);
    const rr = await tekstTilKurver(b, new Set(tv.map((t) => t.id)));
    sjekk(!rr.gjort.some((t) => t.usynlig), "Tr 3: tekstTilKurver gjoer ikke om usynlig tekst");
    const igjen = await finnTekst(rr.pdf);
    sjekk(igjen.filter((t) => t.usynlig && t.tekst.trim()).length === usynlige.length, "Tr 3: den usynlige teksten staar igjen som tekst");
  }

  console.log(feil ? `\n${feil} feil` : "\nalt ok");
  process.exit(feil ? 1 : 0);
})();
