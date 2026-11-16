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
| pakk.ts | skyline-pakking av elementene på arket, og profilpakking av formede rammer |
| ramme.ts | rammer som følger formen, med rett bunn |
| klippkant.ts | kutter dekor 50 mm forbi det som synes under bilens egne deler |
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
    npx tsx lagbunn.ts    # ytterkanten i bunn, levende tekst og doble merker meldes
    npx tsx kiatest.ts    # spotfarger, sort ved siden av kuloer, bil inne i stripene
    npx tsx rammetest.ts  # formede, konvekse rammer med rett bunn
    npx tsx klipptest.ts  # kutt og forlengelse under bildelene
    npx tsx tettark.ts    # dyr folie ut av oppsettet naar det loenner seg

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

**Bilskissen leser spotfarger** (`cs`/`scn`), ikke bare `k` og `rg`
(Kia PV5 310079: all dekor var PANTONE 7481 C, og motoren fant ingen
dekor). `lesLett` i `src/bilskisse.ts` og `hentBaner` i `src/uttrekk.ts`
bruker `csFraObj`/`rgbScn` fra `src/pdfbaner.ts`.

**Tegnerekkefølgen skiller designerens sort fra bilens.** CCVision tegner
bilen i K-gråtoner med noen få K 100-deler spredt mellom dem. Designeren
legger dekoren oppå i sammenhengende bolker. En *dekorbolk* er en rekke
flater uten bilgrå eller lyktefarge som inneholder minst én ekte kulør
(CMY ulike). Sort og hvitt teller som dekor bare i en dekorbolk:
- sort i en dekorbolk er kandidat i seg selv («åtg.no» bak),
- sort inntil klyngen hentes inn i flere ledd innenfor bolkene (bokstavene
  og ringen i «ÅTG», som står ved siden av den grønne streken),
- bare flater fra en dekorbolk legges til fra rammen (dørhåndtak og vindu
  inne i stripenes ramme blir stående som bil),
- `bilmotor.ts` tar bare med banene finnDekor faktisk valgte (`liste`),
  ikke alt i rammen.
Grå-regelen (25 % bilgrå = bil) gjelder bare klynger uten ekte kulør i
kjernen, og måles på alt i rammen. Et område som ligger helt i et annet
fjernes som dublett. `test/kiatest.ts` vokter dette.

**Feilsignatur:** en logo der bare de kulørte delene kommer med, eller
grå og hvitt i fargelista til en stripe.

**Tekst og striper som bare står ved siden av hverandre, skjæres hver
for seg** (Eirik 16.11.2026, Kia PV5). Holdt sammen måtte hele rammen
skjæres, nesten bare luft. `samleDeler` i `src/bilmotor.ts` deler hvert
område i delbaner og slår deler sammen bare når de ligger nær hverandre
(`DEL_GLIPPE_MM = 50`) **og** den felles rammen er under `DEL_LUFT = 2`
ganger delenes egne. Bokstaver i en tekst og delene av en logo (ÅTG,
XL-boksen, Osterøy-pinnen med tekst) gir 1,3 til 1,4; A-en med stripen
gir 2,7. Delbaner fra samme bane settes sammen igjen, så hull i
bokstaver står.

**Lange striper skjøtes etter rullbredden, eller skjæres hele hvis det
gir kortere ark.** Kandidat i `kjorJobb`: ett lag, én flate uten hull,
lengre enn det som får plass på tvers og minst `STRIPE_FORHOLD = 8`
ganger så lang som høy. Den deles i like lange stykker med `SKJOT_MM = 10`
overlapp, gruppen pakkes begge veier, og den korteste vinner. Begge
utfallene meldes. Alle kandidatene skjøtes først, så prøves hver av dem
hel igjen: prøvd én og én ble stripen bak (1,5 m) skåret hel fordi
stripene på sidene (2,6 m) uansett gjorde arket langt.

**Skrådde elementer rettes opp i produksjonsfila etter grunnlinjen**
(Eirik 16.11.2026: «tenk alltid baseline»). Designerne skrår elementer for
å følge karosserilinjene. `rettOpp` i `src/bilmotor.ts` stemmer bare med
rette underkanter: kanter innenfor `RETT_MAKS_GRAD = 6` fra vannrett som
har formen over seg og luft under. Runde bokstaver med buet bunn stemmer
ikke. Føttene på A-en, underkanten på en stripe, bunnen av R, E, L og T, og
den grønne streken under ÅTG gir helningen. Kursiv står rett fordi
bunnene er vannrette. Elementet roteres fra `RETT_MIN_GRAD = 0,3°`, og det
meldes («Monteres med samme helning som på skissen»). Grunnlinjen må være
minst 5 % av bredden for å telle. `test/kiatest.ts` vokter reglene.

**Kundeskissen viser bilen slik den blir.** `hentBaner` i `src/uttrekk.ts`
tar med klippebanene (`W`/`W*`) på hver bane (`klipp`), og `tegnBilSkisse`
klipper med dem og tegner alt i skissens rekkefølge. Stripene ender da ved
hjulbuene, som designeren har tegnet dem. Målrammene rundt dekoren vises
bare med `visMaal`, ikke på kundeskissen: de gjorde den til en
produksjonstegning. Skjærefilene bruker fortsatt hele banen.

**Vindusrutene er gradienter, ikke hvite flater.** CCVision tegner rutene
som en klippebane (`W n`) fulgt av `/Sh0 sh`, en aksial gradient i
`DeviceN [/Black]` med en FunctionType 4 som tintTransform. Uten `sh` ble
rutene hvite på kundeskissen, og på førersiden (Kia PV5 310079) så det ut
som om den sorte A-en ikke var klippet langs ruten. `hentBaner` gir nå en
bane med `gradient` for hver `sh`, fylt innenfor klippet, og
`tegnBilSkisse` tegner den. Prosessfargene (Cyan, Magenta, Yellow, Black)
i en Separation/DeviceN med CMYK-alternativ tolkes direkte, uansett
tintTransform, så de aldri blir en reservefarge. Gradientbaner tas aldri
med i et element. `test/kiatest.ts` vokter dette.

**Feilsignatur:** hvite vindusruter på kundeskissen der originalen har
tonede ruter.

**Dekor som går inn under bilens egne deler kuttes 50 mm forbi det som
synes** (Eirik 16.11.2026, Kia PV5). Designeren tegner A-en opp under
ruta og speilet, og stripen inn under hjulbuene. I CCVision er det ikke en
klippebane, men bildeler tegnet oppå dekoren. `kuttVedBildeler` i
`src/klippkant.ts`: synlig = dekoren minus fylte ikke-dekorbaner tegnet
etter den, og dekoren kuttes langs synlig utvidet med `KLIPP_LUFT_MM = 50`,
med hullene fylt, så håndtak og speil inne i dekoren aldri blir hull.
Små, tynne synlige øyer (under 5 % av største synlige del og tynnere enn
10 mm) er gjennomsyn, for eksempel sort A mellom hjulbue og dekk, og styrer
ikke kuttet. Går dekoren mindre enn `KLIPP_MIN_MM = 20` inn under en
bildel, **forlenges den** til 50 mm under bildelen, i sin egen retning (en
liggende stripe blir lengre, ikke tykkere), og det meldes. Lar den seg
ikke forlenge, meldes det. **Kuttlinjen er rett** (Eirik 16.11.2026:
«bein i toppen»): det tillatte er det konvekse skallet rundt det synlige
utvidet med 50 mm, så A-en ikke får en dupp der beina møtes. **Små
knotter styrer ikke kuttet**: en sort flekk ved speilfoten ga først en
halvsirkel og så en tapp. Det synlige åpnes med `KNOTT_ANDEL`, og biter som
forsvinner og er under `KNOTT_MAKS` x 20² mm² (1600 mm²) tas ikke med, med
merknad. Større biter er dekor og står. `test/klipptest.ts`
vokter kutt, forlengelse og knotter.
Dette er ikke et unntak fra «motoren fjerner aldri noe»: alt som synes,
står. Det meldes med spart areal. `test/kiatest.ts` vokter det.

**Feilsignatur:** synlig dekor som mangler i produksjonsfila, eller striper
som er like lange som tegnet langt inn under hjulbuen.

**Striper med ender under bilen blir rette rektangler, og endene kan
strekkes ut** (Eirik 16.11.2026). En stripe (én konveks flate, minst 8
ganger så lang som bred) som går godt forbi det som synes, får hver skjult
ende rettet ut til rektangel langs stripen (`kuttVedBildeler`). Det legger
bare til folie under bildelen. En stripe som slutter ved en kant på bilen
(en av bilens linjer krysser midtlinjen innenfor `KANT_ENDE_MM = 15` fra
enden, `enderVedKant`), som stripen bak på Kia, merkes på samme måte.
Endene skrives i element-PDF-en som nøkkelord `signhub-forleng:venstre,hoyre`
(ingen endring i appen), og skjøtte stykker arver bare de ytterste endene.
På et Appliser+thru-ark strekker `strekkUt` i `src/motor.ts` slike ender ut
i dødrommet, til naboen eller feltkanten, og skyver elementet over først
hvis plassen ligger på motsatt side. Kia: stripestykkene bak strekkes 311 mm
hver, så hele feltet er fylt. Meldes per element. Utstrekkingen går
nøyaktig til naboen eller kanten (ikke avrundet), så alle endene ligger på
samme linje: et sprang på en millimeter mellom to rader er kniven i nesten
samme spor. Elementer der alle fire sider er rette, tegnes på nytt som et
eksakt rektangel på rammens mål.

Appliser+thru bruker **hele skjærebredden**: rullen minus `rullKant`,
innenfor summa, uten regmark-marger (det er ingen regmarks), minus
overmålet. På 1260-folie gir det et felt på 1220 mm.

**Feilsignatur:** en stripe med skrå ende på et Appliser+thru-ark, eller
dødrom ved siden av en stripe som er merket som forlengbar.

**Levende tekst i en bilskisse meldes, den forsvinner aldri i stillhet.**
Motoren leser bare baner. Tekst som ikke er konvertert til kurver kom
ikke med: på 309916 manglet «XL-BYGG Osterøy» på to av tre steder, mens
pinnen ved siden av kom med. `lesBilskisse` returnerer nå `levendeTekst`,
og tekst ved et element gir merknaden «er IKKE med i skjaerefilene».
Rutinen er at designerne konverterer tekst til kurver før korrekturen
lagres.

**Samme merke sett fra to visninger meldes, det fjernes ikke.** Panseret
står både i front (978 x 55, sammentrykt) og topp (227 x 978). Like
farger i likt forhold, lik lengste side og kortere andre side gir
`sammeSom` på elementet og en merknad. Appen bør la brukeren ta det ut.

**Fargen som danner ytterkanten legges i bunn som ett helt stykke**
(Eirik 16.11.2026). XL-logoen: gullramme, svart rute, gull XL. Med svart
i bunn må ytterkanten av ruten treffe innerkanten av rammen, og en
forskyvning gir en tynn stripe. Med gull i bunn som rektangel og svart
oppå med XL skåret ut finnes ingen slik kant. Regelen i `kjorJobb`: et
lag som ikke er nederst, men som med hullene fylt dekker minst
`RAMME_FYLL = 0.995` av motivet, flyttes til bunnen. Den lagvise
oppbyggingen fyller det så. Det synlige bildet er det samme. Regelen
gjelder **per øy**, ikke per element: på panser og bakluke står XL-boksen
ved siden av PROFF i samme element, og der danner gull bare kanten av
XL-boksen. Fargen flyttes når den dekker hver øy der den ligger sammen med
andre farger.

**Glipper ingen kniv kan skjære er tegnefeil og fylles.** På XL-logoen når
den svarte ruten nesten opp til gullrammen: en glippe 710 mm lang og
0,01 mm bred. Med gull i bunn ble den to skjærelinjer tvers over gullet.
Hull med snittbredde under `GLIPPE_MM = 0.1` fylles med folie og meldes
(«Ingenting er fjernet»). Grensen er **absolutt**, aldri relativ til
logoens størrelse: den gamle restfjerningen var relativ og tok hele
bokstaver. Dette legger til folie, det trekker aldri fra.
`test/lagbunn.ts` vokter dette og de to reglene over.

**Passmerke mellom elementer som er delt for å spare folie** (Eirik
16.11.2026). XL-boksen og PROFF er ett merke, men skjæres hver for seg.
`leggPassmerker` i `src/bilmotor.ts` finner par i samme visning, side om
side med luft under halve høyden, i omtrent samme høyde og med en felles
farge. Det høyeste elementet får en loddrett strimmel, 10 mm bred, i den
mørkeste felles fargen ved naboens nærmeste kant og i naboens fulle høyde,
5 mm inn under naboen og 5 mm utenfor (Eirik: loddrett, ikke vannrett). Montøren
legger naboen der strimmelen viser og river strimmelen av. Elementer som
telles i flere eksemplarer får ikke passmerke. Feltet `passmerke` på
elementet og en merknad sier fra.

**Feilsignatur:** to like kanter som må treffe hverandre ved montering,
tekst som mangler ved siden av et element, eller samme merke skåret to
ganger.

**Mørk bil: hvitt er dekor, sort er lakken** (Eirik 16.11.2026, Mercedes
Vito i sort). `finnDekor` i `src/dekorfinn.ts` avgjør `moerkBil` ut fra om
sort eller hvitt dekker mest. På mørk bil byttes reglene for sort og hvitt:
sort avslutter en dekorbolk, hvit i en dekorbolk er kandidat, og en bolk med
minst `LYS_BOLK = 6` hvite flater teller som dekor («24 timers service» på
ruta). Sort i dekoren skjæres likevel alltid: på glass er sort kontur
bunnfolie med sterkere lim (961).

**Hva hører sammen?** (Eirik: «det er jo det som er kunsten å svare på»).
`samleDeler` i `src/bilmotor.ts`:
- det som er skrevet i samme retning er én tekst; to deler med grunnlinjer
  som avviker mer enn `TEKST_VINKEL = 5°` (modulo 90) slås ikke sammen. Vito:
  logoen er skrådd 20°, telefonnummeret står vannrett ved siden av;
- linjer i samme tekst kan stå opptil `TEKST_LINJE = 1,2` ganger
  bokstavhøyden fra hverandre («24 timers service:» over «41770011»);
- en flate tykkere enn bokstavene og større enn teksten tar ikke med seg
  tekst som står ved siden av (den røde flaten bak på Vito);
- en stripe (én eller to flater, minst 8:1) limes ikke fast i det som står
  inntil, og hører bare til naboen når naboen spenner over minst
  `STRIPE_SPENN = 0,9` av den (ÅTG-streken på Kia hører til bokstavene,
  logoen på Vito-stripen gjør ikke);
- en del som ikke får plass på tvers av rullen (`MAKS_DEL_MM = 1150` målt
  dreid inntil 35°) deles finere, og en stor flate (over `STOR_FLATE_MM`)
  tar da ikke med bokstaver ved siden av.
Skrådde logoer rettes opp etter grunnlinjen inntil `STOR_GRAD = 35°` når
rammen da blir under `STOR_GEVINST = 0,75` av den vanlige, eller elementet
ellers ikke får plass.

**Stripen skjøtes i bilens egen skjøt** (Eirik 16.11.2026, Vito: «viktig da
med god overlapp slik at vi kan bruke bilens naturlige skjøt»; «minimum 3
cm»). `skjoterLangs` i `src/klippkant.ts` finner bilens linjer som krysser
hele stripen (på nedre kvartil, midten og øvre kvartil), og `skrivPdf`
skriver dem som `signhub-skjot:<andel>,...`. `kjorJobb` velger færrest og
jevnest skjøter som gir stykker som får plass, og hvert stykke går
`SKJOT_BIL_MM = 30` inn på den andre siden.

**Merknadene er bare det et menneske må gjøre noe med** (Eirik
16.11.2026: «dette er bare støy for menneske. vi vil bare at det funker»).
`lesBilskisse` gir `merknader` (levende tekst, samme merke to ganger, synlig
dekor som ikke kom med, dekor som ikke lot seg forlenge, skisse som ikke er
til å stole på) og `logg` (kutt ved bildelene, striper rettet ut, deling,
retting etter grunnlinjen, passmerke, plate tatt ut). Appen viser bare
`merknader`. `test/kiatest.ts` feiler hvis loggføring havner i merknadene.

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

**Vito-reglene (Eirik 16.11.2026, kveld):**
- Stripeender under bilen foelger kantene videre i sin retning
  (`stripeKanter` i `src/klippkant.ts`, `strekkUt` i `src/motor.ts`), aldri
  et rektangel paa full bredde. Feilsignatur: en firkant paa enden av en
  stripe som smalner av.
- Kiss+thru med rektangulaere rammer legges kant i kant (`kantIKant`):
  thru er sammenslaatte linjer (`slaaSammenKanter`), kiss-boksen ligger
  `boksKiss` innenfor rammen. Formede rammer bare naar de gir kortere ark.
- Ingen ytre kiss-ramme rundt hele arket.
- Et felt (ett helt, konvekst stykke over `DELT_FELT` av elementet) og
  farger som nesten ikke overlapper det (`DELT_OVERLAPP`), produseres hver
  for seg naar det sparer minst `DELT_SPAR` av arkene. Fargen under gaar
  `UNDERLAP_MM` inn under der de moetes. Folie med pris er tettArk sitt.
- Printede elementer: hullene beholdes i utfallet (`utfallendeHull`), saa
  punsene ikke fylles.
- `helfoliering: true` paa folien gir ren Thru-fil uten applisering.

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

**Et ark slås bare sammen med et annet når det ikke blir lengre.** En
gruppe med færre folier (PROFF i bare sort) kan legges inn på arket til en
gruppe med flere (XL-boksene i gull og sort) for å spare en oppspenning.
Men da blir arket lengre også for gullet, som PROFF ikke bruker: på 309916
ble gullet 2,27 m mot 1,39 m, mens totalen bare økte 0,48 m og slapp
gjennom oppspenningsgrensen på 0,5 m. Metrene havner på en folie som kan
koste mange ganger mer. Regelen (Eirik 16.11.2026): slå bare sammen når de
flyttede elementene får plass uten at arket blir lengre. `test/lagbunn.ts`
prøver dette med `oppspenningM: 10`, der bare denne regelen holder PROFF
på eget ark.

Like filnavn (samme folie og prosess på to ark) får `del 1 av 2`.

**Rammene følger elementets form, bunnen er alltid rett** (Eirik
16.11.2026). Thru-cut-rammen og kiss-cut-boksen var rektangler. Nå lager
`src/ramme.ts` rammen som det konvekse skallet rundt elementets omriss
(alle fargene) utvidet med bleed og den rette bunnen. **Thru-cut kan
aldri være konkav** (Eirik 16.11.2026): i et innvendig hjørne rivner
folien, og en innbuktning gjør arket slapt. Kiss-boksen er rammen utvidet med
`boksKiss`. Bunnen er grunnlinjen montøren retter inn etter. `pakk.ts`
pakker rammene på et høydeprofil, speilvendt så toppene lager daler, og
speiler oppsettet tilbake. Formede rammer brukes bare når arket blir minst
1 mm kortere enn med rektangler; ellers står rektanglene. Kia PV5: 5,55 m
til 5,30 m. `test/rammetest.ts` vokter rett bunn, kiss utenfor rammen og
gapet mellom rammene.

**Feilsignatur:** en ramme uten rett bunn, en konkav ramme, eller to rammer
nærmere hverandre enn `gap`.

**Lange tekster skjøtes i mellomrommet mellom bokstavene** (Eirik
16.11.2026). En tekst lengre enn det som får plass på tvers (Kia: «RØR -
ELEKTRO - ENERGI», 1233 mm) måtte ligge på langs og ga et ark på 1273 mm
for nesten ingenting. Samme kandidatregel som stripene, men med flere
deler: skjøten legges i glippen (minst `TEKST_GLIPPE_MM = 3`) nærmest
like lange stykker, og stykket før tar med `TEKST_PASS_MM = 10` av neste
bokstav som passmerke. Montøren legger neste stykke så bokstaven dekker
stubben. Stykkene beholder hele tekstens høyde og får rektangulære
rammer, så thru-cut på begge sider av skjøten ligger på samme linje og
montøren kan treffe etter kanten. Kia: tekstarket fra 1273 til 406 mm,
hele jobben fra 5,55 til 4,26 m. `test/kiatest.ts` vokter det.

**Ingen doble linjer i produksjonsfilene** (Eirik 16.11.2026). Wild
skjærer hver linje i fila, uansett farge, så to linjer ved siden av
hverandre blir skåret to ganger. Elementene er én bane hver: fylt med
skjermfargen (foliens hex som `rg`) og streket i CutContour i samme `B*`.
Kiss-boksen uten fyll rundt hvert thru-cut-element står (Eirik
16.11.2026: den skal ikke fjernes); bare rene thru-ark har ingen.

**Ark med bare hele stykker er bare thru-cut** (Eirik 16.11.2026, Kia PV5:
stripestykkene i grønt). Er arket én folie, og hvert element er én hel,
konveks flate uten hull (minst 99 % av sitt eget konvekse skall), er
elementet selve stykket. Det er ingenting å luke: folien appliseres og
elementene thru-cuttes langs kanten. Banen streket i Through er eneste
linje. Ingen ramme, ingen kiss, ingen bleed, og ingen regmarks, fordi det
bare er én oppgave på summaen. Metoden heter **Appliser+thru** (Eirik
16.11.2026): folien appliseres på et felt først, så thru-cuttes
elementene. Arket er feltet: elementene pluss `APPLISER_OVERMAAL_MM = 20`
på hver side, rundet opp til hele 10 mm, og feltet står i filnavnet,
`<jobb> Appliser+thru <folie> felt <B>x<L> 100%.pdf`, og i PDF-tittelen.

**Kant i kant, én linje** (Eirik 16.11.2026, prinsippet fra
klebemerke-skillen). To rette sider som ligger mot hverandre trenger ikke
mellomrom: Appliser+thru-elementene legges kant i kant, og linjen de deler
skjæres én gang. `retteSider` i `src/motor.ts` finner sidene formen ligger
langs (innenfor `RETT_SIDE_MM = 0.5`, minst `RETT_SIDE_ANDEL = 0.97` av
lengden), og retter dem helt ut til rammen, utover, aldri innover, så to
kanter aldri ligger en brøkdel av en millimeter fra hverandre. `pakkKant` i
`src/pakk.ts` gir rette sider 0 og andre sider halvt gap. Skjærelinjene
ligger i Through: `slaaSammenLinjer` i `src/produksjonsfil.ts` slår
sammen stykker på samme linje, setter dem sammen til sammenhengende baner
og tar dem i nærmeste-nabo-rekkefølge. Flatene ligger under i
Design-laget med bare fyll i foliens farge og ingen strek, så det er
tydelig hvilken farge arket er (Eirik 16.11.2026). To lag er greit akkurat
her, fordi Appliser+thru bare kjøres på summa, som skjærer etter
spotfargen Through. Regelen om ingen doble linjer gjelder filer som kan gå
på wild. Kia: stripearket fra 500 til 460 mm. `test/kiatest.ts` feiler
hvis en linje skjæres to ganger eller to parallelle linjer ligger under
2 mm fra hverandre.
`test/kiatest.ts` og `test/skjultkutt.ts` (en hel sirkel) vokter det.

**Feilsignatur:** et element tegnet to ganger (en fylt og en streket kopi),
manglende kiss-boks rundt thru-cut-elementene, eller regmarks og kiss på et
ark med bare hele stripestykker.

**Tett ark for dyr folie** (Eirik 16.11.2026, Kia PV5: grønt printet på
hvit 3M refleks, 498 kr/m² pluss laminat 45). I oppsettet må hver farge
ligge i samme ramme som de andre, og rammene følger de store elementene.
`tettArk` i `src/motor.ts` regner, for hver farge i en flerfarget gruppe
som har `prisM2` på folien: folie i oppsett (arklengde x rullbredde x pris)
mot folie tett pluss biter x `overteipMinPerBit` (standard 0,5 min, Eiriks
anslag: ca. 5 min for de 10 bitene på Kia) x `timekostKr` (standard 900,
full selvkost), minus det de andre fargene sparer når oppsettet blir
kortere. Bare når alle bitene er hele, konvekse flater uten hull. Er tett
billigst, tas fargen ut av elementene og hver bit blir et eget element.
Begge utfall meldes med regnestykket og grensen i minutter. Uten pris
røres ingenting. Med `print: true` blir det tette arket **Print+thru**:
regmarks, fyllet printet `PRINT_BLEED_MM = 2` utenfor kuttet, kant i kant
og sammenslåtte linjer som Appliser+thru. Kia: refleks fra 2,08 m² i
oppsett til 0,43 m² tett (stripene kommer i tillegg i begge).
`test/tettark.ts` vokter det.

**Den tette gruppen er én logo om gangen** (Eirik 16.11.2026, etter Kia
PV5). Bitene til ett element tas ut sammen: kiss rundt hver bit, og
thru-cut `TETT_THRU_MM = 3` utenfor, rundt hele gruppen. Linjen foelger bitene tett og bygger bare bro over mellomrommet (minste morfologiske lukking som gjoer bitene til ett stykke; Eirik: «ingen grunn til at thrucuten skal gaa opp igjen paa toppene»),
**minus det som skal vaere sort**, saa thru-cut aldri gaar inn over en annen
farge. Montoeren stripper én logo og legger den samlet. Fila heter
`Print+kiss+thru` (eller `Kiss+thru` uten print) og har regmarks, fordi det
er to oppgaver. Det tette er fortsatt **med i oppsettet** som markering:
fyll i fargen og kiss-strek, bare paa primaerarket (`markering` paa
elementet), saa montoeren ser hvor bitene skal.

**Logogruppene og stripene er aldri paa samme ark** (Eirik 16.11.2026: «vi
hadde jo en kongefil for stripene»). Gruppene kiss-cuttes, lukes og legges
over paa det sorte oppsettet; stripene har sin egen fil (Appliser+thru, eller
Print+thru paa printmedium). Gruppenoekkelen faar `|tett`, og slike grupper
slaas aldri sammen med andre. Arket med logogrupper **nestes paa formen**
(`nestForm` i `src/pakk.ts`): thru-formen utvidet med halve gapet rastreres
konservativt paa et rutenett (`NEST_RES = 2.5` mm), proeves i fire retninger
(`snu` paa plasseringen er 180°), med flere rekkefoelger, og brukes bare naar
den gir kortere ark. Kia: logoarket 474 mm, stripearket 447 mm.

**Skyline etterfylles** (`komprimer` i `src/pakk.ts`): et element som ble
liggende oeverst fordi skyline ikke ser hull under et overheng, flyttes til
den laveste ledige plassen. Kia: tekstarket fra 406 til 325 mm («- RØR» og
«åtg.no» opp ved siden av de lange tekstene).

**Printfila bruker spotfargen fra skissen, ikke skjermfargen.** `csFraObj`
gir `spot` (navn og alternativ, ogsaa Lab som Illustrators Pantone-bibliotek
bruker) paa Separation-rom, `hentBaner` legger den paa banen, og `skrivPdf`
skriver `signhub-spot:<k-verdi>=<navn>@<tint>@<cmyk>[@<hvitpunkt>@<Lab>]` i
element-PDF-ens noekkelord. `kjorJobb` kobler laget til spotfargen paa hex og
fyller med `/CS2 cs` i en Separation med samme navn og alternativ. Kia:
PANTONE 7481 C med Lab 62,75 / -73 / 36. Mangler spotfargen, meldes det.

**Materialet sier om det kan printes, innholdet avgjoer** (Eirik
16.11.2026). `print: true` paa folien betyr printmedium (3M refleks hvit,
kanskje 3106). Er laget hvitt, skjaeres folien som den er (Appliser+thru);
har det farge, printes det. `printes()` i `src/motor.ts`.

**Feilsignatur:** gronne biter som ligger hver for seg paa det tette arket,
en thru-cut som gaar over sort, `rg` i stedet for `/CS2 cs` paa et printark
med spotfarge i skissen, eller hvitt paa refleks som blir Print+thru.

Filnavn: `<jobbnavn> <prosess> <foliekode> 100%.pdf`, for eksempel
`Informativ logo 2026-11-16 Kiss+thru 751-027 100%.pdf`. Prosess er
`Kiss+thru` på primærfargen, `Kiss` på fargene som legges oppå, og
`Appliser+thru` (med `felt BxL` etter folien) på ark med bare hele stykker.
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
