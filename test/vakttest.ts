/**
 * Vaktene som skulle ha fanget materiallista.
 *
 * Appen sendte materiallista inn som fargekatalog til foreslaFolier. Den
 * har varenummer, bredde og pris, men ingen hex. Motoren leste manglende
 * hex som sort, saa hver farge traff samme oppforing, alle lagene fikk
 * samme foliekode og smeltet sammen, og produksjonsfila ble et fylt
 * rektangel. Det tok tre runder aa finne. Disse tre vaktene sier fra med
 * en gang.
 */
import * as fs from "fs";
import { foreslaFolier, kjorJobb, analyserFil } from "../src/motor";

let feil = 0;
const sjekk = (navn: string, ok: boolean, detalj = "") => {
  console.log(`   ${ok ? "ok  " : "FEIL"}  ${navn}${detalj ? "  — " + detalj : ""}`);
  if (!ok) feil++;
};

// slik materiallista faktisk saa ut: varenummer, bredde, pris, ingen hex
const MATERIALLISTE: any[] = [
  { kode: "751-010", breddeMm: 1260, pris: 289 },
  { kode: "751-031", breddeMm: 1260, pris: 289 },
  { kode: "751-070", breddeMm: 1260, pris: 289 },
  { kode: "751-086", breddeMm: 1260, pris: 312 },
];
const KATALOG: any[] = [
  { kode: "751-010", hex: "#FFFFFF", breddeMm: 1260 },
  { kode: "751-031", hex: "#E6000D", breddeMm: 1260 },
  { kode: "751-070", hex: "#1A1A1A", breddeMm: 1260 },
  { kode: "751-086", hex: "#0033FF", breddeMm: 1260 },
];
const FARGER = [
  { hex: "#E6000D", andel: 0.5 },
  { hex: "#0033FF", andel: 0.3 },
  { hex: "#FFFFFF", andel: 0.2 },
];

(async () => {
  console.log("1. foreslaFolier avviser en katalog uten farger");

  let kastet = "";
  try { foreslaFolier(FARGER as any, MATERIALLISTE); }
  catch (e: any) { kastet = e.message; }
  sjekk("materiallista kaster", kastet !== "");
  sjekk("teksten peker paa aarsaken",
    /materiallista/i.test(kastet) && /hex/i.test(kastet),
    kastet.slice(0, 60) + "...");

  kastet = "";
  try { foreslaFolier(FARGER as any, []); }
  catch (e: any) { kastet = e.message; }
  sjekk("tom katalog kaster", kastet !== "");

  // noen mangler hex: de skal hoppes over, ikke tolkes som sort
  const blandet = [{ kode: "751-999", breddeMm: 1260 }, ...KATALOG];
  const advarsler: string[] = [];
  const gammelWarn = console.warn;
  console.warn = (m: any) => advarsler.push(String(m));
  const blandetSvar = foreslaFolier(FARGER as any, blandet as any);
  console.warn = gammelWarn;
  sjekk("delvis katalog melder fra", advarsler.some((a) => /751-999/.test(a)));
  sjekk("den uten hex ble ikke valgt",
    !blandetSvar.some((f) => typeof f !== "string" && f.kode === "751-999"));

  console.log("\n2. foreslaFolier godtar hex i flere former");

  const former: any[] = [
    { kode: "A", hex: "#E6000D", breddeMm: 1260 },
    { kode: "B", hex: "0033FF", breddeMm: 1260 },     // uten krall
    { kode: "C", hex: "#fff", breddeMm: 1260 },       // tre tegn, sma bokstaver
  ];
  const svar = foreslaFolier(
    [{ hex: "#E6000D", andel: 0.4 }, { hex: "#0033FF", andel: 0.4 },
     { hex: "#FFFFFF", andel: 0.2 }] as any, former);
  const koder = svar.map((f) => (typeof f === "string" ? f : f.kode));
  sjekk("rod traff A", koder[0] === "A", koder.join(", "));
  sjekk("bla traff B uten krall", koder[1] === "B");
  sjekk("hvit nederst blir negativt", koder[2] === "negativt");

  // hvit som ikke ligger nederst skal treffe den tre tegns hviten
  const svar2 = foreslaFolier(
    [{ hex: "#FFFFFF", andel: 0.5 }, { hex: "#E6000D", andel: 0.5 }] as any, former);
  const k2 = svar2.map((f) => (typeof f === "string" ? f : f.kode));
  sjekk("tre tegns hex utvides og treffer", k2[0] === "C", k2.join(", "));

  kastet = "";
  try {
    foreslaFolier(FARGER as any,
      [{ kode: "X", hex: "gronn", breddeMm: 1260 }] as any);
  } catch (e: any) { kastet = e.message; }
  sjekk("ikke-farge kaster", kastet !== "", kastet.slice(0, 50) + "...");

  kastet = "";
  try {
    foreslaFolier([{ hex: "ikke en farge", andel: 1 }] as any, KATALOG);
  } catch (e: any) { kastet = e.message; }
  sjekk("ubrukelig hex paa inndata kaster", kastet !== "");

  console.log("\n3. kjorJobb advarer naar alle lag far samme foliekode");

  const pdf = new Uint8Array(fs.readFileSync("mf.pdf"));
  const a = await analyserFil(pdf);
  const EN: any = { kode: "751-070", hex: "#1A1A1A", breddeMm: 1260 };

  const alleLike = await kjorJobb({ jobb: "V", linjer: [
    { navn: "Alle like", pdf, breddeMm: 300, antall: 1,
      folier: a.farger.map(() => EN) }] } as any);
  sjekk("advarsel naar alle tre far samme kode",
    alleLike.advarsler.some((x: string) => /samme foliekode/.test(x)),
    `${a.farger.length} lag -> ${EN.kode}`);

  const ulike = await kjorJobb({ jobb: "V", linjer: [
    { navn: "Ulike", pdf, breddeMm: 300, antall: 1,
      folier: [{ kode: "751-040", hex: "#BE19FF", breddeMm: 1260 },
               { kode: "751-010", hex: "#FFFFFF", breddeMm: 1260 },
               EN] }] } as any);
  sjekk("ingen advarsel naar foliene er ulike",
    !ulike.advarsler.some((x: string) => /samme foliekode/.test(x)));

  console.log(feil === 0 ? "\nok: alle tre vaktene holder"
                         : `\nFEIL: ${feil} sjekker feilet`);
  if (feil) process.exit(1);
})();
