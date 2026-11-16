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

**Valget i `folier`-tabellen heter `negativt`, ikke `hull`.** Det er ordet
verkstedet bruker: fargen skjæres ikke i egen folie, den skjæres negativt ut
av fargen under, så underlaget står fram der den ligger. Ligger den nederst,
er det ingen farge under å skjære den ut av, og da faller den bort helt.
`foreslaFolier` returnerer `negativt`.

`hull` er det gamle navnet på samme valg og er **utgått**, men behandles
likt så lenge appen ennå kan sende det. Begge går gjennom `erNegativt()` i
`src/motor.ts`, ett sted, så de aldri kan komme i utakt. `kirkejobb.ts`
beviser aliaset ved å kjøre samme jobb med begge ordene og sammenligne
banene i alle filene.

Merk at `hull` som **geometrisk** begrep — antall hull i en flate, hullene
et lag fyller igjen — er riktig norsk og står uendret. Det er bare valget i
folier-tabellen som har byttet navn.

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
    npx tsx vakttest.ts   # vaktene i foreslaFolier og kjorJobb
    npx tsx platetest.ts  # bakgrunnsplaten holdes utenfor valgene
    npx tsx kuttvakt.ts   # vakten rundt kuttingen per element og farge
    npx tsx malestokk.ts  # den trykte malestokken er fasit
    npx tsx skjultkutt.ts # ingen skjulte baner (Form XObject/klipp) i produksjonsfilene
    npx tsx ingenfjernet.ts # motoren fjerner aldri noe fra logoen
    npx tsx bilfarger.ts  # bilens deler er ikke dekor, svart logo-flate er ikke lakk

Fasit på `mf.pdf` (Martine Finsås, det vanskeligste tilfellet vi har):

    mftest    lilla 35,9 %   hvit 21,1 %   sort 43,0 %
    mflag     lag 0 lilla, lag 1 hvit, lag 2 sort   (øverst først)
    mfjobb    primær 751-040 (lilla), tynneste detalj 0,85 mm, kritisk
              tre ark, 660 x 551 mm
              (0,85 mm er en harfin bit etter lagdelingen. Den fjernes ikke
              lenger, se «Motoren fjerner aldri noe» under. For 16.11.2026
              ble den fjernet, og fasit var 3,14 mm.)
    stabel    ok

Sort på 43,0 % beviser at stroke-ekspansjonen virker. Faller tallet til
rundt 23 %, er streken ikke fanget opp. Faller det til 42,2 %, er nestingen
tilbake på ett nivå og konturen rundt innmaten er borte.

Uten den harfine biten er tynneste detalj 3,14 mm, innmaten i `A`.
Faller det til 2,44 mm, er hullene i bunnlaget ikke fjernet.

Lilla skal være primær, ikke sort. Det finnes ingen regel om at mørkeste
farge blir primær; øverste farge er primær.

**Konturen rundt innmaten skal aldri skjæres i svart.** Svart er ett helt
stykke i bunn. Konturen oppstår som negative space i hvitt. Nestingen i
`src/pdfbaner.ts` regnes med dybde, ikke ett nivå: like dybde er flate, odde
dybde er hull. Begrunnelsen står i `prompt-claude-code-martine.md`, regel 9.

**Motoren fjerner aldri noe fra en logo** (Eirik 16.11.2026: «det er det
verste som kan skje»). Den gamle regel 10 fjernet hårfine biter under
1,0 mm og 10 mm² som «rester fra subtraksjonen». Den kunne ikke skille
rester fra ekte detaljer: på «informativ» ved 25 mm forsvant hele den hvite
teksten, og ved 50 mm forsvant en detalj. Nå står alt igjen og skjæres, og
slike biter meldes i en advarsel som sier at ingenting er fjernet. Tynneste
detalj måles på alt, så logoen meldes som kritisk når den er det.
`test/ingenfjernet.ts` vokter dette.

**Feilsignatur:** en advarsel som sier at noe er «fjernet fra
skjaerefilene», eller detaljer som mangler i filen i forhold til logoen.

**En bakgrunnsplate er ikke dekor, den er mellomrommet.** Rosen-logoen er
tegnet på en hvit plate som utgjør 73 % av motivet i 13 biter etter at
bokstavene er skåret fra. På bilen er det lakken. Meldes den som en farge
blant de andre, foreslås den som folie, og appen tilbyr klar folie over tre
firedeler av logoen. `lesBilskisse` tar den derfor ut av `farger`, legger
den i `bakgrunn` på elementet, og melder fra i `merknader` med farge og
andel.

Kjennetegnet er **formen, ikke fargen**: nederste lag, og formen før den
skjæres av lagene over fyller motivets ramme. Målt på proace2 gir alle fire
elementene 1,0000; en ellipseformet badge gir 0,7847. `PLATE_FYLL = 0.995`
i `src/bilmotor.ts` ligger høyt med vilje, så en plate med lett avrundede
hjørner fortsatt er en plate, mens en badge med tekst oppå blir stående som
et ekte element.

**En plate tas bare ut når den har bilens farge.** Formen alene er ikke
nok. På 309916 e-expert har XL-logoen en svart firkant innenfor
gullrammen som fyller motivet som en plate. Bilen er hvit, så firkanten er
dekor. Den ble tatt ut, og bare gull ville blitt skåret. Bilens farge er
fyllfargen som dekker mest i skissen (hvit på begge skissene vi har). Er
fargen ulik, blir platen stående og skjæres, med en merknad.

**Bilens egne deler er ikke dekor.** `src/dekorfinn.ts` har `BILFARGER`,
farger som alltid er bilens (CCVision-lykterødt `0,1,1,0.15`), og forkaster
klynger der mer enn 25 % av flaten er rene K-gråtoner (dekk, felg,
hjulbue). Motoren lærer ikke av seg selv: hver skisse som leses feil blir
en fasit i `test/`, og regelen som retter den står med begrunnelse i
koden. `test/bilfarger.ts` vokter e-expert og proace2.

**Feilsignatur:** baklykter, hjul, takrails eller hele taket som
elementer, eller en logo som mister en flate som har en annen farge enn
bilen.

**Det som meldes og det som utleveres må være det samme.** Platen fjernes
fra `farger` **og** fra element-PDF-en. `farger` er derfor nøyaktig
fargelagene i `pdf`, i samme rekkefølge, og listen fra `foreslaFolier` går
rett inn i `kjorJobb` uten at noe legges til bakerst. `bakgrunn` er bare
til opplysning.

Første utgave fjernet platen bare fra `farger`. Appen bygde da `folier`
med to oppføringer, `kjorJobb` leste PDF-en på nytt og fant tre lag, og
laget uten instruks ble forsøkt skåret. Det er nettopp den skjøre
plategeometrien som ikke lar seg kutte, og feilen kom ut på **feil farge**
fordi lagene talte i utakt: «klarte ikke skjaere fargen #0033FF» når det
var den hvite platen som var årsaken. Reprodusert nøyaktig, samme segment
og samme koordinater, ved å la platen ligge igjen i fila.

Platen tas ut ved kilden i `lesBilskisse`: banene som har platefargen
filtreres bort før `skrivPdf`, og alt som meldes — farger, bredde, høyde —
utledes deretter av den fila som faktisk leveres. En bane som både fylles
og strekes fjernes bare når begge deler er platefargen. Blir platen likevel
stående, meldes den som en vanlig farge med en merknad, så listen aldri kan
komme i utakt. `test/platetest.ts` måler dette per element.

Merk at elementets mål krymper noen millimeter når platen forsvinner, fordi
platen stakk litt utenfor selve dekoren. Skalaen er uendret — den er
`målestokk / MM` uansett — så dekoren skjæres i nøyaktig samme størrelse.
Målt på proace2: skåret areal 284 721 mm² før, 284 791 mm² etter, mens arket
går fra 1182 til 1164 mm i bredden.

**`foreslaFolier` skal avvise en katalog den ikke kan bruke.** Appen sendte
en gang materiallista inn som fargekatalog. Den har varenummer, bredde og
pris, men ingen `hex`. Motoren leste manglende hex som sort, så hver farge
traff samme oppføring, alle lagene fikk samme foliekode og smeltet sammen,
og skjærefila ble et fylt rektangel. Det tok tre runder å finne. Nå kastes
det en feil som navngir årsaken, oppføringer uten hex hoppes over med
melding, og `hex` godtas med og uten `#` og i tre tegn. Ingen stille
standard.

**`kjorJobb` advarer når alle fargelagene får samme foliekode.** Da skjæres
motivet som én flate og detaljene forsvinner. Målt før sammenslåingen av
like folier, siden det er nettopp den som skjuler symptomet.

**Feilsignatur:** produksjonsfiler som er fylte rektangler uten innmat, og
alle lag på én foliekode.

**Står det en målestokk på arket, er den fasit.** Målingen er vakthund, ikke
kilde. Den kan aldri treffe eksakt, fordi CCVisions egen tegning ikke stemmer
eksakt med CCVisions eget oppgitte lengdemål: arket sier 1:30 og L 5.309 m,
men rådataen ganget opp 3000 prosent gir 5322,325 mm — 13 mm mer. Utledes
målestokken av L, B og H, sammenlignes en tegning mot et tall som ikke
beskriver den tegningen presist. På proace2 ga det 1:29,8904, altså -0,365
prosent, og alt ble tilsvarende for lite.

`velgMalestokk()` i `src/bilskisse.ts`:

| tilfelle | resultat |
| --- | --- |
| avvik under 3 % | trykt målestokk brukes, `avvikProsent` settes til 0 |
| større, forholdet nær et rent tall | arket er skalert. Meld fra, bruk den målte |
| verken nært eller lite | skissen er ikke til å stole på. Bruk ingen |
| ingen trykt målestokk | bruk den målte, med merknad om at den er utledet |

Merk at vi måler **ytterkanten av streken**, ikke selve banen. Karosseriet er
streket, og halve strekbredden ligger utenfor bilen. Det er derfor våre
177,62 mm er litt mer enn de 177,41 mm som gir 5322,325.

**Feilsignatur:** `avvikProsent` som aldri blir 0 på et ark som oppgir sin
egen målestokk, og produksjonsmål som er en halv prosent for små.

**En rå biblioteksfeil skal aldri nå brukeren.** `polygon-clipping` kan
miste tellingen på hakkete geometri og kaste `Unable to find segment #52671
... in SweepLine tree` rett ut i appen. Vi så den i produksjon på
bakgrunnsplaten i Rosen-logoen. Platen skjæres ikke lenger, så årsaken er
borte, men motoren skal uansett ikke kunne kastes ut med en feil fra et
bibliotek. `kuttTrygt()` i `src/pdfbaner.ts` ligger rundt kuttingen per
element og farge: første forsøk går på geometrien som den er, feiler det
ryddes hver operand med `ryddFlate` og forsøket gjentas **én** gang, og går
det fortsatt ikke kastes en feil som sier hvilket element og hvilken farge
det gjelder. Den rå teksten logges til konsollen, men når aldri brukeren.

Vakten ligger både i den lagvise oppbyggingen i `src/motor.ts` — der hele
oppbyggingen av ett lag ligger inne i den, ikke bare den ene operasjonen som
tilfeldigvis kastet — og i fargesepareringen i `src/pdfbaner.ts`, som er der
feilen faktisk satt. Separeringen vet ikke hvilket element den holder på
med, så den sender tom `element`-streng og lar kallstedet sette navnet på:
`medNavn()` i `src/motor.ts` og et tilsvarende kast i `src/bilmotor.ts`.
Regel 13 i `prompt-claude-code-martine.md`.

**Feilsignatur:** en feilmelding i appen som nevner `SweepLine tree`,
`segment #` eller et annet internt begrep fra et bibliotek.

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

**Ingen skjulte baner i produksjonsfilene.** Composer, som leser
wild-fila, skjaerer alle baner, ogsaa usynlige. Motivet ble tidligere lagt
inn som Form XObject, og BBox-en paa en Form XObject tolkes som en
klippebane rundt logoen. Den ble skaaret som en ekstra rute paa logoens
storrelse (funnet 16.11.2026). `byggProduksjonsfil` tegner derfor banene
rett inn paa siden med `skjaereOps()`. `test/skjultkutt.ts` feiler hvis en
produksjonsfil har XObject, `Do`, klippebane (`W`) eller usynlig bane (`n`).

**Feilsignatur:** en ekstra rute paa logoens storrelse i wild-skjaeringen.

## Ikke endre

`STD_GEO` i `src/produksjonsfil.ts` er målt mot maskinene og skal stå:

    foliebredde 1200, rullKant 40, wildMaksRull 1260, wildMaksSkjaer 1215,
    summaMaksSkjaer 1600, bleed 5, gap 7.5, regmarkD 5, kissInset 5,
    regClear 5, regmarkKiss 2.5, boksKiss 2.5, regTarget 500, strek 0.25

Det lages **én produksjonsfil per folie** (fra 16.11.2026). Wild-fila
kan kjøres på både summa og wild, så primærfargen får bare den. Er folien
bredere enn 1260 mm, eller kommer ytterste kiss-cut utenfor 1215 mm, lages
summa-varianten med doble regmarks i stedet, med advarsel. Det er ikke et
valg i skjemaet.

Filnavn: `<jobbnavn> <prosess> <foliekode> 100%.pdf`, for eksempel
`Informativ logo 2026-11-16 Kiss+thru 751-027 100%.pdf`. Prosess er
`Kiss+thru` på primærfargen og `Kiss` på fargene som legges oppå.
Ingen maskinnavn og ingen rolleord i navnet. Antall står ikke i navnet,
fordi elementene allerede er ganget opp på arket.

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
* `src/motor.d.ts` blir **ikke** typesjekket av prosjektets egen
  tsconfig. `tsc --listFiles` laster bare `src/motor.ts`; TypeScript ser
  d.ts-en som deklarasjonsfil for ts-en og henter den aldri inn. Den kan
  derfor drive fritt fra implementasjonen, slik `folier` gjorde da den sto
  som `(Folie | null)[]` lenge etter at `"hull"` var innført, og slik
  `lesBilskisse` og `foreslaFolier` gjorde da de manglet helt. Skal den
  sjekkes, må det gjøres med et eget tsconfig-oppsett **utenfor**
  prosjektet: kopier d.ts-en til et annet navn, importer typene derfra, og
  tilordne de ekte funksjonene og returverdiene til dem.
* En slik sjekk må negativt kontrolleres før den kan stoles på. To forsøk
  ga «null feil» uten å sjekke noe: først fordi importen traff `motor.ts`
  i stedet for d.ts-en, så implementasjonen ble sammenlignet med seg selv,
  og deretter fordi tsconfig-en brukte `baseUrl`, som er fjernet i
  TypeScript 7, så `tsc` avbrøt på konfigurasjonen. Brekk noe med vilje,
  se sjekken feile på riktig sted, og sett det tilbake.
* Bygget er ikke byte-stabilt mellom esbuild-versjoner. Små forskjeller i
  filstørrelse skyldes navnetildeling i minifikatoren, ikke endret logikk.
  Sammenlign oppførsel gjennom testene, ikke md5.

## Arbeidsdeling

Beregning, PDF, folie, nesting, regmarks og skjærefiler hører hjemme her.
Skjermbilder, skjemaer, priser, tilbud, kunder og database hører hjemme i
Lovable-appen. Er du i tvil, spør før du koder: en endring lagt på feil
side må gjøres om.
