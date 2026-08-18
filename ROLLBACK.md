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
    cp versjoner/signhub-motor-2026-08-18.js signhub-motor.js
    git commit -am "Rull tilbake motor til 2026-08-18"
    git push origin main

Det kan også gjøres i GitHub-web: åpne arkivfila, kopier innholdet, og
erstatt innholdet i `signhub-motor.js` i rot.

## Etter rollback

Pages bygger på nytt automatisk. Bygget tar erfaringsmessig to til
fire minutter i dette repoet. Verifiser deretter at riktig fil er ute:

    curl -s https://eirikinformativ.github.io/signhub-motor/signhub-motor.js | md5sum
    md5sum versjoner/signhub-motor-2026-08-18.js

De to summene skal være like. Får du fortsatt gammelt innhold, er det
som regel cache — Pages sender `Cache-Control: max-age=600`, så både
CDN og nettleser kan holde på forrige versjon i inntil ti minutter.
Hard refresh i nettleseren (Ctrl/Cmd+Shift+R) omgår den lokale cachen.
