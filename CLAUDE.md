# Materiálový optimalizátor – nářezové plány pro CNC

Webová aplikace (jen frontend, bez serveru) pro tvorbu nářezových plánů.
Vstup: CSV (rozměry a počty obdélníkových dílů) nebo DXF či DWG (tvary dílů).
Výstup: rozmístění dílů na tabule pro CNC (frézka, vysekávací lis) a export.
Komunikuj česky, UI aplikace je česky.

## Rozsah

- Pouze volné skládání pro CNC. Gilotinové řezy neřešit.
- Negenerujeme G-kód ani pořadí řezů – to dělá CAM. Exportujeme DXF s rozmístěnými díly.
- Jednosouborový HTML build nedělat.
- Úplný seznam úkolů a hranice rozsahu: @PLAN.md

## Stack

React + TypeScript (strict) + Vite, Zustand, Papa Parse, dxf-parser,
port knihovny Clipper (offsety, NFP), Comlink (Web Worker), Dexie (IndexedDB),
fflate (ZIP), Vitest + fast-check, Playwright, ESLint, Prettier.

## Příkazy

- `npm run dev` – vývojový server
- `npm run test` – jednotkové testy (jednorázový běh, ne watch)
- `npm run typecheck` – kontrola typů (`tsc --noEmit`)
- `npm run lint` – ESLint
- `npm run format` – Prettier
- `npm run build` – produkční build
- `npm run e2e` – Playwright testy
- Jeden test: `npx vitest run tests/core/geometry/polygon.test.ts` (filtr názvu `-t "text"`),
  `npx playwright test tests/e2e/<soubor>.spec.ts`

## Automatika (hooky v `.claude/hooks/`)

- Po každé úpravě souboru se spustí Prettier a `eslint --fix`; zbylé chyby ESLintu
  se vrátí k opravě.
- Hook při ukončení spustí typecheck a testy, a dokud v `PLAN.md` zbývají kroky
  a není BLOKOVÁNO, pošle zpět k dalšímu kroku. Ruční pauza: soubor `.claude/state/pause`.
- Blokováno: zápis mimo projekt, `.env`, úpravy existujících fixtures, force push,
  `git reset --hard`, `git rebase`, `git config`, `git remote add|set-url` aj.
  Remote proto musí nastavit uživatel.

## Struktura

```
src/
  main.tsx, app/            vstup aplikace, App.tsx, styles.css
  ui/                       React komponenty (FileDrop, PartsTable, SheetSettings, PlanView, ExportPanel)
  state/                    Zustand store
  core/                     čisté jádro – bez Reactu, DOM a prohlížečových API
    model.ts                Part, Sheet, NestingParams, Placement, NestingResult, ForbiddenZone
    geometry/               polygony, transformace, offset, EPS
    import/                 csv.ts, dxf.ts, dwg.ts (DWG → DXF přes acad-ts)
    nesting/                maxrects.ts, nfp.ts, placer.ts, optimizer.ts
    export/                 dxf-writer.ts, svg.ts, csv.ts
    metrics.ts              využití, odpad, zbytky
  worker/                   nesting.worker.ts (Comlink)
  storage/                  db.ts (Dexie)
tests/
  fixtures/csv/, dxf/, dwg/   testovací vzorky (existující soubory neměnit)
  core/                     jednotkové a property testy
  e2e/                      Playwright
docs/                       format-csv.md, zavislosti.md, rozhodnuti/
```

## Architektura

- `src/core/` nesmí importovat React, DOM ani nic z `src/ui`, `src/state`,
  `src/worker`, `src/storage` (hlídá ESLint `no-restricted-imports`).
- Výpočet nestingu běží vždy ve Web Workeru, nikdy v UI vlákně.
- Komponenty jen zobrazují a volají store, žádná geometrie v UI.

## Konvence geometrie

- Délky interně vždy v mm. Převod jednotek DXF jen v `core/import/dxf.ts`.
- Počátek vlevo dole, osa Y nahoru (jako DXF). Převrácení osy jen při vykreslení SVG.
- Úhly ve stupních, kladně proti směru hodinových ručiček.
- Vnější kontura proti směru hodinových ručiček (CCW), otvory po směru (CW).
- Čísla porovnávat s tolerancí `EPS` z `core/geometry/eps.ts`, nikdy `===`.
- Rozestup: díl se nafoukne o rozestup/2; užitná plocha tabule = tabule − okraj + rozestup/2.

## Slovník

- tabule – deska nebo plech, na který se skládá
- díl – kus k vyrobení, může mít otvory
- rozestup – min. vzdálenost dílů = průměr nástroje + rezerva
- okraj – nevyužitelný pruh po obvodu tabule
- zakázaná zóna – oblast, kam nesmí díl (např. upínky vysekávacího lisu)
- využití – plocha dílů / plocha použitých tabulí
- zbytek – využitelná nepoužitá část tabule
- NFP / IFP – no-fit polygon / inner-fit polygon

## Pracovní postup (autonomní)

- Zdrojem pravdy je `PLAN.md`. Postupuj samostatně krok za krokem, bez ptaní
  a bez čekání na schválení dílčích kroků.
- Pracuj vždy na prvním neodškrtnutém kroku.
- Po každém kroku: `npm run lint`, `npm run typecheck` a `npm run test` projdou →
  odškrtni krok v `PLAN.md` → aktualizuj sekci „Stav" → commit
  `typ: popis (krok X.Y)` (typ = feat, fix, test, refactor, docs, chore).
- Každá změna v `src/core` má test. Invarianty nestingu ověřuj property testy
  (fast-check): žádný překryv, vše v užitné ploše mimo zakázané zóny, dodržen rozestup.
- Po každém kroku v `src/core/nesting` nebo `src/core/geometry` spusť subagenta
  `revize-geometrie` a oprav, co najde.
- Na konci každé fáze: `git push`. Když push selže (např. chybí přihlášení),
  zapiš to do „Odchylky" a pokračuj – push není blokující.
- Drobné odchylky od plánu proveď a zapiš do sekce „Odchylky" (co a proč).
- Závislosti instaluj podle `PLAN.md`. Jinou jen s licencí MIT, Apache-2.0,
  BSD, ISC nebo BSL-1.0 a se zápisem do „Odchylky". GPL/AGPL nikdy.
- Existující soubory v `tests/fixtures/` neměň – nové přidávat smíš.
  Neprocházející test nikdy neopravuj úpravou vstupních dat ani oslabením asercí.
- Soubory `.claude/settings.json` a `.claude/hooks/` neměň.
- Zastav se jen když:
  1. krok nejde splnit ani po 3 různých pokusech,
  2. bylo by nutné změnit rozsah nebo architekturu oproti `PLAN.md`,
  3. šlo by o nevratnou akci mimo projekt.
     Pak v „Stav" nastav `BLOKOVÁNO: ano – důvod` a skonči.
