# Rollback av signhub-motor

## Hvordan motoren distribueres

`signhub-motor.js` i rot av dette repoet publiseres av GitHub Pages fra
`main` / (root), og lastes ved kjøring av Lovable-appen:

    https://eirikinformativ.github.io/signhub-motor/signhub-motor.js

Importen skjer i appens `src/motor/index.ts`. Det betyr at **et push til
`main` går rett i produksjon** — ingenting gjøres i Lovable.

## Versjonsarkiv

Mappen `versjoner/` inneholder daterte kopier av tidligere publiserte
bundles, navngitt `signhub-motor-ÅÅÅÅ-MM-DD.js`. Filene i `versjoner/`
serveres også av Pages, men brukes ikke av appen — de er kun arkiv.

Legg alltid en datert kopi i `versjoner/` **før** du erstatter
`signhub-motor.js` i rot, ellers finnes det ikke noe å rulle tilbake til.

## Rulle tilbake

Kopier ønsket versjon over fila i rot og push til `main`:

    git checkout main
    git pull origin main
    cp versjoner/signhub-motor-2026-08-19-for-innmatfiks.js signhub-motor.js
    git commit -am "Rull tilbake motor til før innmatfiksen"
    git push origin main

Arkivet nå:

| fil | hva det er |
| --- | --- |
| `signhub-motor-2026-08-18.js` | første arkiverte bundle |
| `signhub-motor-2026-08-19-for-innmatfiks.js` | siste versjon før innmat- og restfiksen, uten versjonsstempel. Samme innhold som 2026-08-18-kopien. |

Den første publiserte bundlen med versjonsstempel er `6cf05b8`.

Det kan også gjøres i GitHub-web: åpne arkivfila, kopier innholdet, og
erstatt innholdet i `signhub-motor.js` i rot.

## Etter rollback

Pages bygger på nytt automatisk. Byggetiden i dette repoet har ligget
mellom ett og fire minutter. Verifiser deretter at riktig fil er ute:

    curl -s https://eirikinformativ.github.io/signhub-motor/signhub-motor.js | md5sum
    md5sum versjoner/signhub-motor-2026-08-18.js

De to summene skal være like. Får du fortsatt gammelt innhold, er det
som regel cache — Pages sender `Cache-Control: max-age=600`, så både
CDN og nettleser kan holde på forrige versjon i inntil ti minutter.
Hard refresh i nettleseren (Ctrl/Cmd+Shift+R) omgår den lokale cachen.
