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

I tillegg eksporteres `STD_GEO`, `MIN_DETALJ`, `ADVAR_DETALJ`, `DISCLAIMER`
og `VANNMERKE`. Full typedefinisjon i `motor.d.ts`.

## Kildefiler

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
`pdfbaner.ts` eller `motor.ts`.

## Bygg

    npm install
    npx esbuild motor.ts --bundle --format=esm --platform=browser \
      --minify --outfile=signhub-motor.js

Resultatet er rundt 660 kB og inneholder alt: pdf-lib, polygon-clipping,
clipper-lib og bildene. Ingen CDN, ingen WASM, ingen pdf.js.
Detaljer i `BYGG.md`.

## Kjør testene før du pusher

Dette er ikke valgfritt. Motoren har ingen CI, så disse testene er den
eneste sikringen mellom en endring og produksjonsgulvet.

    npx tsx mftest.ts     # farger og areal i Martine Finsås
    npx tsx mflag.ts      # lagene, øverst først
    npx tsx mfjobb.ts     # hele jobben
    npx tsx stabel.ts     # register: arkene lagt oppå hverandre

Fasit på `mf.pdf` (Martine Finsås, det vanskeligste tilfellet vi har):

    mftest    lilla 36,4 %   hvit 21,4 %   sort 42,2 %
    mflag     lag 0 lilla, lag 1 hvit, lag 2 sort   (øverst først)
    mfjobb    primær 751-040 (lilla), tynneste detalj 3,14 mm, ok
    stabel    ok

Sort på 42,2 % beviser at stroke-ekspansjonen virker. Faller tallet til
rundt 23 %, er streken ikke fanget opp. Tynneste detalj på 3,14 mm beviser
at bunnlaget skjæres solid. Faller det til 2,44 mm, er hullene ikke fjernet.

Lilla skal være primær, ikke sort. Det finnes ingen regel om at mørkeste
farge blir primær; øverste farge er primær.

`kirke.pdf` og `hb.ai` er med fordi de avdekket hver sin egen feil:
en clipping-path som ble tolket som hvit bakgrunn, og en logo som ble vist
sort før folie var valgt. Kjør dem ved endringer i `pdfbaner.ts`.

## Ikke endre

`STD_GEO` i `produksjonsfil.ts` er målt mot maskinene og skal stå:

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
