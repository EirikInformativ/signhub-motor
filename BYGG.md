# Bygge motoren

Kildefilene er TypeScript med `.ts` i importene. De bygges til én
selvstendig ESM-fil med esbuild.

## Hvor ting ligger

| sti | innhold |
| --- | --- |
| `src/` | motorens 11 kildefiler, med `motor.ts` som inngang |
| `src/motor.d.ts` | typene til det offentlige API-et |
| `test/` | testskript og testfiler (`mf.pdf`, `kirke.pdf`, `hb.ai`) |
| `signhub-motor.js` | den ferdige bundlen, publisert av GitHub Pages fra rot |
| `versjoner/` | daterte kopier av tidligere publiserte bundles |

Lovable-appen laster `signhub-motor.js` fra rot over GitHub Pages. Se
`ROLLBACK.md` for hvordan man ruller tilbake.

## Installer

```
npm install
```

## Bygg den selvstendige filen (den SignHub laster fra nett)

```
npx esbuild src/motor.ts \
  --bundle \
  --format=esm \
  --platform=browser \
  --minify \
  --outfile=signhub-motor.js
```

Resultatet er rundt 660 kB. Alle avhengigheter (pdf-lib, polygon-clipping,
clipper-lib) og alle bilder (disclaimer, vannmerke, base64 i `assets.ts`)
ligger inne i filen. Ingen CDN, ingen WASM, ingen pdf.js.

Bygget er reproduserbart så lenge esbuild-versjonen er den samme.
`package-lock.json` låser esbuild til 0.28.2, som kommer inn via `tsx`.
Med den versjonen gir kilden 660 666 byte, md5 `d51b3dfb38126ae1df19a73b450dd048`
— **ustemplet**, altså bygget slik kommandoen over gjør det.

## Versjonsstempling

`src/motor.ts` eksporterer `VERSJON`, satt til plassholderen `__VERSJON__`.
Workflowen bytter den ut med kort commit-SHA og byggetidspunkt rett før
esbuild kjører, så en publisert bundle vet hvor den kommer fra:

    export const VERSJON = "8068736 2026-08-19T07:54Z";

Motoren logger dette til konsollen når den lastes. Er bundlen bygget utenom
workflowen, står plassholderen igjen, `USTEMPLET` er `true`, og loggen sier
`SignHub-motor: ustemplet bygg (lokal kilde)` i stedet. En ustemplet bundle
skal ikke se ut som en stemplet.

Konsekvensen for md5: stempelet endrer seg ved hvert bygg, så to bygg av
samme kode får ulik md5. Workflowen sammenligner derfor med stempelet nullet
ut, og rapporterer begge summene. Skal du sammenligne selv:

    sed -E -e 's/[0-9a-f]{7} [0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}Z/__V__/g' \
           -e 's/__VERSJON__/__V__/g' signhub-motor.js | md5sum

Den summen er stabil på tvers av stempler. Er den lik, er koden lik.
En annen esbuild-versjon gir samme oppførsel, men andre minifikatornavn og
dermed en annen md5.

## Bygg uten avhengigheter (til liming rett inn i et prosjekt)

```
npx esbuild src/motor.ts \
  --bundle \
  --format=esm \
  --platform=browser \
  --external:pdf-lib \
  --external:polygon-clipping \
  --external:clipper-lib \
  --outfile=motor.bundle.js
```

## Kjøre testene

`tsx` kjører TypeScript direkte, uten byggesteg. Testene leser testfilene
med relative stier, så de må kjøres **fra `test/`**:

```
cd test
npx tsx mftest.ts     # farger og areal i Martine Finsås
npx tsx mflag.ts      # lagene, øverst først
npx tsx mfjobb.ts     # hele jobben, skriver mfL_*.pdf
npx tsx mffv.ts       # forhåndsvisning som png
npx tsx stabel.ts     # legger arkene oppå hverandre og sjekker register
```

Testfilen er `mf.pdf`. Fasit står i `prompt-claude-code-martine.md` i rot.

Disse kjører også, mot `kirke.pdf` og `hb.ai`:

```
npx tsx kirketest.ts kirkebbox.ts kirkejobb.ts    # clipping-path-tilfellet
npx tsx hbtest.ts     # .ai lagret PDF-kompatibelt
```

De øvrige skriptene i `test/` peker på kundefiler under `/home/claude/`
som ikke ligger i repoet. De feiler med `ENOENT` til filene legges tilbake.

Skriptene skriver resultatene sine (`mfL_*.pdf`, `fv_*.png`, `senter.pdf`)
i `test/`. De er byggeprodukter og er holdt utenfor git.

## Automatisk bygg

`.github/workflows/bygg.yml` bygger bundlen ved hvert push som rører
`src/`, `package.json` eller `package-lock.json`, og sammenligner den med
fila i rot.

Selve innbyttet er avskrudd som standard. Workflowen commiter bare når
repository-variabelen `AUTOBYGG` står på `ja`
(Settings → Secrets and variables → Actions → Variables). Uten den bygger
og rapporterer den, men rører ikke `signhub-motor.js`.

Når `AUTOBYGG` er på, arkiverer workflowen den gamle fila i `versjoner/`
før den skriver den nye — samme rutine som i `ROLLBACK.md`.
