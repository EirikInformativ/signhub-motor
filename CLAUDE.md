# signhub-motor

Beregningsmotoren til SignHub. Gjør en vektorlogo (PDF eller .ai lagret
PDF-kompatibelt) om til ferdige skjærefiler for skjæreplotter, samt
kundeskisse i A4.

Eid av Informativ Skilt & Dekor AS.

## Dette repoet er produksjon

GitHub Pages publiserer fra `main` / `(root)`. Et push til `main` går rett
ut til brukerne. Det finnes ingen staging, ingen review-gate og ingen CI
som stopper deg.

SignHub-appen (bygget i Lovable) laster motoren ved kjøring fra:

    https://eirikinformativ.github.io/signhub-motor/signhub-motor.js

I appen finnes bare `src/motor/index.ts`, 22 linjer som gjør den importen.
**Ingenting skal gjøres i Lovable når motoren endres.** Koblingen er
permanent og skal ikke røres.

Pages sender `Cache-Control: max-age=600`. En ny versjon kan derfor ta opptil
ti minutter før alle klienter ser den. Det gjelder like mye ved rollback.

## Grensesnittet appen er avhengig av

Disse fire funksjonene kalles fra appen. Endrer du signaturen til en av dem,
brekker appen, og da må Lovable-siden endres i samme slengen.

    analyserFil(pdf: Uint8Array): Promise<FilAnalyse>
    kjorJobb(b: Bestilling): Promise<JobbResultat>
    forhandsvis(pdf, farger?, valg?): Promise<Forhandsvisning>
    lastBilder(): Promise<{ disclaimer, vannmerke }>

I tillegg eksporteres `STD_GEO`, `MIN_DETALJ`, `ADVAR_DETALJ`, `DISCLAIMER`,
`VANNMERKE`, `VERSJON` og `USTEMPLET`. Full typedefinisjon i
`src/motor.d.ts`.

`VERSJON` sier hvilken bundle appen faktisk kjører, på formen
`"8068736 2026-08-19T07:54Z"` — kort commit-SHA og byggetidspunkt. Den settes
av `.github/workflows/bygg.yml`, som bytter ut plassholderen `__VERSJON__` i
`src/motor.ts` rett før esbuild kjører. Motoren logger den til konsollen ved
lasting. Er bundlen bygget utenom workflowen, står plassholderen igjen og
`USTEMPLET` er `true`. Appen skal lese `VERSJON` i stedet for å gjette på hva
som kjører.

Fordi stempelet endrer seg ved hvert bygg, er md5 på bundlen ikke lenger
stabil mellom to bygg av samme kode. `BYGG.md` viser hvordan man
sammenligner med stempelet nullet ut.

## Kildefiler

Kilden ligger i `src/`, testene i `test/`. Stiene under er relative til `src/`.

| fil | ansvar |
| --- | --- |
| pdfbaner.ts | leser PDF-en, gir geometri per farge, ekspanderer stroke til form |
| motor.ts | kjorJobb() og analyserFil(), lagvis oppbygging, rollefordeling |
| pakk.ts | skyline-pakking av elementene på arket |
| produksjonsfil.ts | selve arket: lag, regmarks, thru-cut, kiss-cut. Eier STD_GEO |
| skjaereform.ts | byggSkjaereform() og separasjon() (spotfargene Through og CutContour) |
| tykkelse.ts | måler tynneste detalj |
| forhandsvis.ts | canvas-forhåndsvisning i valgte foliefarger |
| skisse.ts, skisse_kunde.ts, skisselayout.ts | kundeskisse i A4 |
| assets.ts | disclaimer og vannmerke som base64 |

`prompt-claude-code-martine.md` er fasiten for hvordan separeringen og den
lagvise oppbyggingen skal virke, med begrunnelser. Les den før du endrer
`src/pdfbaner.ts` eller `src/motor.ts`.

## Bygg

    npm install
    npx esbuild src/motor.ts --bundle --format=esm --platform=browser \
      --minify --outfile=signhub-motor.js

Resultatet er rundt 660 kB og inneholder alt: pdf-lib, polygon-clipping,
clipper-lib og bildene. Ingen CDN, ingen WASM, ingen pdf.js.
Detaljer i `BYGG.md`.

## Kjør testene før du pusher

Dette er ikke valgfritt. `.github/workflows/bygg.yml` bygger bundlen, men
kjører ingen tester og stopper ingen push. Disse testene er fortsatt den
eneste sikringen mellom en endring og produksjonsgulvet.

Testene leser testfilene med relative stier og må kjøres fra `test/`:

    cd test
    npx tsx mftest.ts     # farger og areal i Martine Finsås
    npx tsx mflag.ts      # lagene, øverst først
    npx tsx mfjobb.ts     # hele jobben
    npx tsx stabel.ts     # register: arkene lagt oppå hverandre
    npx tsx bmtest.ts     # spotfarger: to Pantone i Bergen Mekaniske
    npx tsx piggtest.ts   # nullbrede pigger, Nytveit ved seks bredder
    npx tsx askotest.ts   # lagreglene: fire farger i ASKO reklame

Fasit på `mf.pdf` (Martine Finsås, det vanskeligste tilfellet vi har):

    mftest    lilla 35,9 %   hvit 21,1 %   sort 43,0 %
    mflag     lag 0 lilla, lag 1 hvit, lag 2 sort   (øverst først)
    mfjobb    primær 751-040 (lilla), tynneste detalj 3,14 mm, ok
              tre ark, 660 x 551 mm
    stabel    ok

Sort på 43,0 % beviser at stroke-ekspansjonen virker. Faller tallet til
rundt 23 %, er streken ikke fanget opp. Faller det til 42,2 %, er nestingen
tilbake på ett nivå og konturen rundt innmaten er borte.

Tynneste detalj på 3,14 mm er innmaten i `A`, ikke bunnlaget. Faller det til
2,44 mm, er hullene i bunnlaget ikke fjernet. Faller det til 0,85 mm og
`kritisk`, er restfjerningen borte.

Lilla skal være primær, ikke sort. Det finnes ingen regel om at mørkeste
farge blir primær; øverste farge er primær.

**Konturen rundt innmaten skal aldri skjæres i svart.** Svart er ett helt
stykke i bunn. Konturen oppstår som negative space i hvitt. Nestingen i
`src/pdfbaner.ts` regnes med dybde, ikke ett nivå: like dybde er flate, odde
dybde er hull. Begrunnelsen står i `prompt-claude-code-martine.md`, regel 9.

Hårfine rester fra subtraksjonen mellom lagene fjernes fra skjærefilene når
de er **både** tynnere enn 1,0 mm og mindre enn 10 mm², og det legges en
advarsel. Et ekte element som er tynt skal fortsatt meldes som kritisk.
Regel 10 i samme dokument.

**Spotfarger skal tolkes gjennom `tintTransform`, aldri som sort med en
styrke.** En Pantone-logo bruker `cs` og `scn` med navngitte fargerom, ikke
`rg` eller `k`. Tolker man tinten som «sort med denne styrken», blir alle
spotfargene `#000000`, og separeringen slår dem sammen. Fargerom er
representert som `{ n, tilRgb(v) }` i `src/pdfbaner.ts`. Lar
`tintTransform` seg ikke tolke, for eksempel `FunctionType 4`, får
separasjonen en egen stabil farge utledet av navnet — aldri sort. Tint 0
gir hvit, og hvitt avgjøres av rgb, ikke av fargeromtypen. Regel 11 i
`prompt-claude-code-martine.md`.

**Feilsignatur:** en flerfarget logo som kommer inn som **ett sort lag**
betyr at spotfargetolkningen er borte.

**Lagvis oppbygging fyller hull innenfor egen form, ikke unionen av alt
som ligger over.** Et lag fyller igjen hullene fargene over har stanset ut
av det, men bare de som ligger innenfor lagets egen form. Tidligere tok
laget med seg alt som lå over, også det som lå ved siden av, og da la vi
folie oppå folie uten grunn: på ASKO-logoen fikk den nesten hvite teksten
hele ASKO under seg, og snakkeboblen fikk hele logoen. Ligger en farge
inni laget, skal hullet fylles; ligger den ved siden av, skal laget ikke
røres. Regel 4 i `prompt-claude-code-martine.md`. Regelen om at nederste
lag skjæres helt fylt står uendret.

**Fargelinjer med samme folie er ett lag.** Setter brukeren samme folie på
to fargelinjer, slås de sammen med `pc.union` før lagvis oppbygging, og
laget beholder plassen til den øverste. Dette må rettes ved kilden:
produksjonsdelen slår opp laget sitt med `find` på foliekode, og `find`
stopper ved første treff, så uten sammenslåingen forsvinner det nederste
laget stille ut av skjærefila. Regel 4b i samme dokument.

**Feilsignatur:** to fargelinjer på samme folie der bare den øverste
kommer med i skjærefila.

`test/askotest.ts` dekker lagreglene på `asko.ai`: fire farger, at de to
nesten like vinrøde ikke slås sammen, at den nesten hvite teksten skjæres
positivt i hvit folie, at ingen farge skjæres både positivt og negativt, og
at ingen lag svelger logoen. Alt måles på de ferdige skjærefilene, ikke på
en kopi av regelen inne i testen. Verifisert ved å reversere regel 4: den
nesten hvite teksten gikk fra 456 til 4292 i areal, snakkeboblen fra 5992
til 9829, og testen feilet med exit 1.

**Nederste lag fyller igjen de hullene fargene over dekker, ikke alle
hull.** Bunnlaget behandles som alle andre lag. Den gamle regelen fylte det
blankt ut, og det holdt så lenge bunnlaget faktisk lå under alt annet, som
på Finsås. Ligger det stort sett åpent, som blå på Nytveit-logoen, ble «DIN
TRANSPORTØR» skåret som klumper uten innmat i D, R, A, O og P. Innmat som
ingen farge ligger oppå, skal skjæres. Regel 5 i
`prompt-claude-code-martine.md`.

**Feilsignatur:** bokstaver som kommer ut som klumper uten innmat.

**Smale spor er renner i formen, ikke luft mellom former.** En farge som
ligger i en åpen renne i fargen under, ligger ikke i et hull, så regel 4
ser den ikke og sporet blir skåret bort fra det underliggende laget.
`lukkGlipper()` i `src/pdfbaner.ts` gjør morfologisk lukking før
utfyllingen finner hva som er innenfor. `SPOR_MM = 4` står ved siden av
`MIN_DETALJ` i `src/motor.ts`. Merk at lukking tetter åpninger opp til
**to ganger** delta, altså 8 mm, og at den ikke skiller en renne fra et
smalt gap mellom to atskilte flater i samme lag. Regel 12 i samme dokument.

**Feilsignatur:** en farge som ligger i en renne blir borte fra det
underliggende laget i stedet for å legges oppå.

**En unødvendig skjærelinje midt i et helt element er en nullbred pigg fra
unionen.** Når to flater deler en kant nøyaktig, kan `polygon-clipping`
legge igjen en bane som går ut og rett tilbake langs samme linje. Den har
null areal, men den skjæres. På Nytveit sto den midt i den blå stripen:
subbanen gikk `(118.9284, 99.6053) → (52.1789, 99.4038)` og rett tilbake.
`ryddFlate()` i `src/pdfbaner.ts` kjører `SimplifyPolygons` og
`CleanPolygons` på hvert lag etter den lagvise oppbyggingen.

**Piggen er skalaavhengig, så den må prøves ved flere bredder.** Den samme
logoen gav pigg ved 500 mm elementbredde, men ikke ved 200, 300, 400, 460
eller 560. Én bredde er ikke en test.

`test/piggtest.ts` kjører `nytveit.ai` ved alle seks breddene og feiler med
exit 1 hvis den finner en bane som går ut og rett tilbake. Målt før
`ryddFlate` ble lagt inn: én pigg ved 500 mm, subbane 2 i
`N_sekundaer_751-086.pdf`, mellom `(118.9284, 99.6053)` og
`(52.1789, 99.4038)`. Testen er verifisert ved å slå av `ryddFlate` og se
den feile på nøyaktig det punktet.

`test/kirke.pdf`, `test/hb.ai` og `test/bm.pdf` er med fordi de avdekket
hver sin egen feil: en clipping-path som ble tolket som hvit bakgrunn, en
logo som ble vist sort før folie var valgt, og to Pantone-farger som ble
slått sammen til ett sort lag. Kjør dem ved endringer i `src/pdfbaner.ts`.

Fasit på `bm.pdf` (Bergen Mekaniske, PANTONE 7685 C og PANTONE 294 C):

    bmtest    #2C5697 53,2 %   #002F6D 46,8 %   (to lag)

Det er (44, 86, 151) og (0, 47, 109), nøyaktig det Acrobat rendrer fila til.

Flere skript i `test/` peker på kundefiler under `/home/claude/` som ikke
ligger i repoet: `sepatest.ts`, `fargetest.ts`, `wildgrense.ts`,
`breddetest.ts`, `smaltest.ts`, `blandet.ts`, `enfil.ts`, `farge2.ts`,
`fvtest.ts`, `fvfarge.ts`, `prikk.ts`, `senter.ts` og `test_motor.ts`.
De feiler på manglende fil, ikke på kode.

## Ikke endre

`STD_GEO` i `src/produksjonsfil.ts` er målt mot maskinene og skal stå:

    foliebredde 1200, rullKant 40, wildMaksRull 1260, wildMaksSkjaer 1215,
    summaMaksSkjaer 1600, bleed 5, gap 7.5, regmarkD 5, kissInset 5,
    regClear 5, regmarkKiss 2.5, boksKiss 2.5, regTarget 500, strek 0.25

Er folien bredere enn 1260 mm, eller kommer ytterste kiss-cut utenfor
1215 mm, skal det ikke genereres wild-fil. Det er ikke et valg i skjemaet.

## Rollback

`versjoner/` inneholder kjente gode bundler, datostemplet. Ruller du
tilbake, kopier ønsket fil over `signhub-motor.js` i rot og push til `main`.
Rutinen står i `ROLLBACK.md`. Husk de ti minuttene med cache.

Legg alltid en kopi i `versjoner/` før du bytter ut bundlen i rot.

## Fallgruver

* `pushOperators({ toString })` gjør ingenting. pdf-lib serialiserer via
  `copyBytesInto`. Bruk `PDFOperator.of(raaStreng as any)`.
* `polygon-clipping` og `clipper-lib` er CommonJS. I ren ESM må du hente
  `const pc: any = (mod as any).default ?? mod`, ellers finnes ikke
  `pc.difference`.
* Ikke anta at et stort rektangel bakerst i filen er en hvit bakgrunn som
  kan fjernes. På Den norske kyrkje sin logo var det en clipping-path.
  En heuristikk som sletter det, sletter ekte innhold.
* `String.normalize("NFD")` dekomponerer ikke æ, ø og å. Filnavn må
  erstatte dem eksplisitt.
* Bygget er ikke byte-stabilt mellom esbuild-versjoner. Små forskjeller i
  filstørrelse skyldes navnetildeling i minifikatoren, ikke endret logikk.
  Sammenlign oppførsel gjennom testene, ikke md5.

## Arbeidsdeling

Beregning, PDF, folie, nesting, regmarks og skjærefiler hører hjemme her.
Skjermbilder, skjemaer, priser, tilbud, kunder og database hører hjemme i
Lovable-appen. Er du i tvil, spør før du koder: en endring lagt på feil
side må gjøres om.
