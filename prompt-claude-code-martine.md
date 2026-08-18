# Oppdrag: fargeseparering og lagvis oppbygging i produksjonsmotoren

Du jobber på en TypeScript-motor som gjør en vektorlogo om til skjærefiler for
skjæreplotter (Summa og wild). Testcasen under er logoen til **Martine Finsås**.
Den er det vanskeligste tilfellet vi har, og reglene den avdekker er generelle.
Får du denne riktig, er resten enkelt.

## Filene i motoren

| fil | ansvar |
| --- | --- |
| `pdfbaner.ts` | leser PDF-en, gir geometri per farge |
| `motor.ts` | `kjorJobb()` og `analyserFil()`, lagvis oppbygging, rollefordeling |
| `pakk.ts` | skyline-pakking av elementene på arket |
| `produksjonsfil.ts` | setter sammen selve arket, lag, regmarks, thru-cut, kiss-cut |
| `forhandsvis.ts` | canvas-forhåndsvisning i valgte foliefarger |
| `skisse.ts`, `skisse_kunde.ts`, `skisselayout.ts` | kundeskisse i A4 |

## Slik ser testlogoen ut

Tre farger. Nedenfra og opp, slik de faktisk ligger i filen:

1. **Sort**, nederst, som to solide silhuetter
2. **Hvit**, et tynt bånd mellom sort og lilla
3. **Lilla**, øverst, selve teksten

Den innerste sorte konturen er ikke en egen form. Den er en **stroke på den
lilla teksten**. Det er den som velter alle naive implementasjoner.

Ferdig produkt: sort folie legges først, hvit oppå, lilla øverst. Lilla er
applikasjonsmaster.

## Reglene

### 1. Stroke skal gjøres om til form som aller første operasjon

Før noe annet skjer, skal hver stroke ekspanderes til en fylt kontur, slik
Illustrator gjør med Expand Appearance.

Konkret i `pdfbaner.ts`:

* Operatorer som fyller: `f F f* b b* B B*`
* Operatorer som streker: `S s b b* B B*`
* Delbaner som skal lukkes før ekspansjon: `s b b*`
* Linjebredden skaleres med `Math.sqrt(Math.abs(det(CTM)))`, ikke med `a`
  alene. En ujevn CTM gir ellers feil bredde.
* Bruk `ClipperOffset` med `etClosedLine` for lukkede delbaner, og
  `etOpenButt` / `etOpenRound` / `etOpenSquare` etter linecap for åpne.
  Join: `jtMiter` (0), `jtRound` (1), `jtSquare` (2). Offset er `bredde / 2`.
* En `B`-operator gir **to** bidrag: fyllet og den ekspanderte streken.

Kontroll: på Martine Finsås skal sort gå fra ca. 23,0 % til ca. 42,2 % av
motivets areal når stroke-ekspansjonen virker. Blir tallet stående på 23 %,
er streken ikke fanget opp.

### 2. Malerrekkefølgen skal bevares

`hentGeometriPerFarge()` skal returnere lagene **øverst først**, altså motsatt
av rekkefølgen de ble malt i. Ikke sorter lagene etter areal, og ikke sorter
dem etter lyshet.

To feil kommer av å bryte denne regelen:

* teller feil antall farger når samme farge males flere ganger
* velger feil primærfarge

### 3. Øverste farge er primær

Primærfargen eier regmarks og thru-cut, og er den de andre legges under.
Ved flere folier:

```ts
const rekke = gruppe[0].deler.map((d) => d.folie.kode);
folier.sort((x, y) => rekke.indexOf(x.kode) - rekke.indexOf(y.kode));
```

Bare når jobben har **én** folie kan du falle tilbake på lyshet.

Det finnes ingen regel om at mørkeste farge blir primær. På denne logoen er
sort mørkest og lilla øverst, og **lilla skal være primær**.

### 4. Lagvis oppbygging er standard

Hvert lag skal være unionen av seg selv og alt som ligger over det. Da får
underliggende folie full dekning under de øvre, og registeret trenger ikke å
treffe på hundredelen.

```ts
const lagvis = l.lagvis ?? true;   // standard er true
if (lagvis && deler.length > 1) {
  let akk: MultiPoly = [];
  for (const d of deler) {                 // øverst først
    akk = akk.length ? pc.union(akk, d.flate) : d.flate;
    d.flate = somHull.length ? pc.difference(akk, somHull) : akk;
  }
  const bunn = deler[deler.length - 1];
  bunn.flate = bunn.flate.map((p) => [p[0]]);   // helt fylt, ingen hull
}
```

### 5. Nederste lag skjæres helt fylt, uten hull

Siste linjen over er ikke pynt. Uten den blir innmaten i `a` og `å` hvit,
fordi hvit folie ikke tar høyde for at sort skal få skinne gjennom i kanten.
Med et solid bunnlag slipper man å treffe hundre prosent mellom hvit og sort.

Kontroll: tynneste detalj på Martine Finsås skal gå fra ca. 2,44 mm til ca.
3,14 mm, og status fra `tynn` til `ok`.

### 6. Hvit er en egen farge, ikke et hull

Hvit skal rapporteres som eget lag med `hvit: true`. Brukeren velger selv om
hvit skal skjæres i folie, behandles som hull, eller smeltes sammen med
naboen. Standardvalget i skjemaet er hull, men motoren skal ikke bestemme det.

### 7. Ytre kiss-cut-ramme bare ved flere lag

Rammen rundt hele arket legges bare når jobben har mer enn én folie som skal
legges oppå hverandre. Den skal ligge **mellom** regmarks og thru-cut, ikke
utenfor begge.

### 8. Skjærebredde og maskingrenser

```
skjærebredde = min(foliebredde - 40, maskinens maks)
wild:  maks rull 1260 mm, maks skjærebredde 1215 mm
summa: maks skjærebredde 1600 mm
```

Er folien bredere enn 1260 mm, eller kommer ytterste kiss-cut utenfor 1215 mm,
skal det **ikke** genereres wild-fil. Det skal ikke være et valg i skjemaet.
Grensen gjelder innholdet i filen, ikke artboardet.

Arket skal krympes til det jobben faktisk krever, ikke fylle rullen:

```ts
const brukt = Math.max(...best.ut.map((p) => p.x + p.w));
const arkbredde = Math.min(skjaere, Math.ceil(brukt + 2 * reservert));
```

`Math.ceil` er viktig. Uten den kommer arkbredden ut som 1144,1562872116856.

## Fallgruver vi allerede har gått i

* `pushOperators({ toString })` gjør ingenting. pdf-lib serialiserer via
  `copyBytesInto`. Bruk `PDFOperator.of(raaStreng as any)`.
* `polygon-clipping` og `clipper-lib` er CommonJS. I ren ESM må du hente
  `const pc: any = (mod as any).default ?? mod`, ellers finnes ikke
  `pc.difference`.
* Ikke anta at et stort rektangel bakerst i filen er en hvit bakgrunn som kan
  fjernes. På Den norske kyrkje sin logo var det en clipping-path, ikke et
  fyll. En heuristikk som sletter det, sletter ekte innhold.
* `String.normalize("NFD")` dekomponerer ikke æ, ø og å. Filnavn må erstatte
  dem eksplisitt.

## Slik verifiserer du

1. Kjør separeringen på testfilen og skriv ut areal per farge. Summen av
   lagene skal avvike under 0,1 % fra motivets totale areal.
2. Legg de ferdige skjærefilene oppå hverandre som piksler og sjekk at
   regmarks står i nøyaktig samme posisjon på alle ark.
3. Rendre forhåndsvisningen og se etter at innmaten i `a` og `å` er sort,
   ikke hvit.
4. Sjekk at filnavnet på primærfilen har lilla foliekode, ikke sort.

## Ikke endre

Geometrien i `STD_GEO`: bleed 5, gap 7,5, regmarkD 5, kissInset 5, regClear 5,
regmarkKiss 2,5, boksKiss 2,5, regTarget 500, strek 0,25. De er målt mot
maskinene og skal stå.
