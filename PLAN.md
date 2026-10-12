# Plán stavby – Materiálový optimalizátor (nářezové plány pro CNC)

## Cíl

Frontendová webová aplikace bez serveru. Uživatel nahraje CSV (obdélníkové
díly: rozměry, počty) nebo DXF (tvary dílů). Aplikace je rozmístí na tabule
pro CNC (frézka, vysekávací lis) s co nejlepším využitím materiálu, zobrazí
plán a vyexportuje ho. UI česky, všechny délky v mm.

## Mimo rozsah

- gilotinové řezy
- G-kód, pořadí řezů, nájezdy nástroje (dělá CAM)
- server, uživatelské účty, napojení na ERP
- jednosouborový HTML build
- společný řez sousedních hran

## Závislosti (licenci ověřit v kroku 1.2)

react, react-dom, vite, typescript, zustand, papaparse, dxf-parser,
Clipper port (clipper-lib nebo jiný s permisivní licencí), comlink, dexie,
fflate (ZIP export), vitest, fast-check, @playwright/test, eslint, prettier.
Povolené licence: MIT, Apache-2.0, BSD, ISC, BSL-1.0. GPL/AGPL ne.
MaxRects, NFP, DXF writer a optimalizátor píšeme sami (inspirace SVGnest, MIT).

## Konvence

Viz CLAUDE.md (jednotky, osy, orientace kontur, EPS, struktura složek).

---

## Fáze 1 – Základ projektu

- [x] 1.1 Kostra: Vite + React + TypeScript (strict), struktura složek podle
      CLAUDE.md, skripty dev/build/test/typecheck/lint/format/e2e, Prettier,
      ESLint (flat config, `no-restricted-imports`: src/core nesmí importovat
      React, DOM ani src/ui|state|worker|storage).
      Hotovo: všechny skripty projdou; ESLint hlásí chybu na zkušebním
      zakázaném importu (pak import odstranit).
- [ ] 1.2 Ověření licencí všech závislostí (`npm view <balík> license`),
      zápis do docs/zavislosti.md.
      Hotovo: tabulka balík – verze – licence, žádná nepovolená.
- [ ] 1.3 Datový model `core/model.ts`: Part, Sheet, NestingParams,
      Placement, NestingResult, ForbiddenZone; rotace jako
      'free' | 'ortho' | 'flip' | 'locked'.
- [ ] 1.4 Geometrie `core/geometry/`: Point, Polygon (vnější + otvory),
      plocha, orientace, bbox, rotace/posun, EPS, porovnání s tolerancí.
      Hotovo: jednotkové testy + property testy (rotace o 360° = identita,
      plocha nezávislá na posunu).

## Fáze 2 – CSV a obdélníkový nesting

- [ ] 2.1 docs/format-csv.md + `core/import/csv.ts`: sloupce název, šířka,
      výška, počet, materiál, tloušťka, rotace (volitelné); autodetekce
      oddělovače (; , tab), desetinná čárka, UTF-8 s BOM i Windows-1250
      (TextDecoder), chyby s číslem řádku. Fixtures v tests/fixtures/csv/.
      Hotovo: testy na všechny fixtures včetně chybných vstupů.
- [ ] 2.2 `core/nesting/maxrects.ts`: MaxRects s heuristikami BSSF, BLSF,
      BAF, BL; rotace podle dílu; rozestup (díl nafouknut o rozestup/2,
      užitná plocha = tabule − okraj + rozestup/2); zakázané zóny jako
      předobsazené oblasti; více formátů tabulí s počty skladem; zkusit
      kombinace heuristik a řazení, vrátit nejlepší výsledek.
      Hotovo: property testy – žádný překryv, vše v užitné ploše mimo
      zakázané zóny, rozestup dodržen, každý díl umístěn nebo nahlášen
      jako neumístitelný (např. větší než tabule).
- [ ] 2.3 `core/metrics.ts`: využití po tabulích i celkem, odpad,
      největší volný obdélník (zbytek).
- [ ] 2.4 Web Worker (Comlink): výpočet mimo UI vlákno, průběh, zrušení.
- [ ] 2.5 UI: nahrání souboru (drag & drop), editovatelná tabulka dílů,
      nastavení tabulí (formáty, počty, okraj, zakázané zóny) a parametrů
      (rozestup, rotace), tlačítko Vypočítat, náhled v SVG (zoom, posun,
      popisky, barva podle dílu), přepínání tabulí, souhrn využití.
      Hotovo: průchod v `npm run dev` bez chyb v konzoli (ověřit Playwrightem).
- [ ] 2.6 Úložiště (Dexie): automatické uložení posledního projektu,
      knihovna formátů tabulí, export/import projektu jako JSON.
- [ ] 2.7 E2E test: nahraj fixture CSV → zobrazí se plán a využití > 0 %.

## Fáze 3 – Export

- [ ] 3.1 `core/export/dxf-writer.ts`: DXF R12 ASCII (nejširší kompatibilita
      s CAM), vrstvy TABULE, DILY, OTVORY, POPISKY, oblouky zachovány jako
      ARC; jeden soubor na tabuli, všechny tabule jako ZIP (fflate).
      Hotovo: test „zapiš → přečti dxf-parserem → stejné souřadnice v EPS".
- [ ] 3.2 SVG export a tisk/PDF přes tiskové CSS (A4/A3 na šířku,
      jedna tabule na stránku, legenda a souhrn).
- [ ] 3.3 CSV výstup: seznam dílů po tabulích + souhrnný řádek.
- [ ] 3.4 E2E: výpočet → stažení DXF, SVG a CSV proběhne bez chyby.

## Fáze 4 – Import DXF (umísťování přes obalový obdélník)

- [ ] 4.1 `core/import/dxf.ts`: LINE, ARC, CIRCLE, LWPOLYLINE (bulge),
      POLYLINE, ELLIPSE, SPLINE (aproximace s tolerancí), INSERT (bloky
      s transformací); $INSUNITS → mm (chybí-li, předpoklad mm + varování);
      TEXT, DIMENSION, HATCH ignorovat.
- [ ] 4.2 Sestavení kontur: spojení koncových bodů s tolerancí, odstranění
      duplicit, uzavření, rozpoznání vnější kontury a otvorů, sjednocení
      orientace. Neuzavřené kontury nahlásit srozumitelnou chybou.
- [ ] 4.3 Díly z DXF: režim „1 soubor = 1 díl" i „více dílů v souboru"
      (každá vnější kontura = díl); počet zadán v tabulce dílů; nahrání
      více souborů najednou.
- [ ] 4.4 Fixtures DXF: generované vlastním writerem + ručně psané okrajové
      případy (nespojené čáry, duplicity, palce, blok, díl s otvory, spline).
- [ ] 4.5 Nesting přes obalový obdélník (MaxRects), v náhledu a exportu
      skutečný tvar dílu včetně otvorů a oblouků.
      Hotovo: E2E nahraj DXF → plán → export DXF; testy na všechny fixtures.

## Fáze 5 – Tvarový nesting

- [ ] 5.1 Offset kontur o rozestup/2 (Clipper), zjednodušení polygonů,
      aproximace oblouků pro výpočet (export dál z původní geometrie).
- [ ] 5.2 NFP díl–díl (Minkowského součet přes Clipper) a IFP (vnitřek
      užitné plochy tabule), zakázané zóny jako překážky; cache NFP podle
      (díl A, rotace A, díl B, rotace B).
- [ ] 5.3 Placer: pro každý díl a povolené natočení nejnižší a nejlevější
      přípustná pozice; neumístitelné díly → další tabule.
- [ ] 5.4 Optimalizátor: genetický algoritmus nad pořadím a natočením,
      časový limit, průběžné posílání nejlepšího výsledku do UI.
- [ ] 5.5 Property testy: plocha průniku dvou dílů < EPS, vše uvnitř užitné
      plochy, vzdálenost dílů ≥ rozestup − EPS.
- [ ] 5.6 UI: volba režimu (obdélníkový / tvarový), průběh, tlačítko
      „Zastavit a použít nejlepší".
- [ ] 5.7 Výkon: benchmark 200 dílů / 10 různých tvarů; první výsledek
      do 5 s, výsledek tvarového režimu nesmí být horší než přes obalový
      obdélník. Při nesplnění optimalizovat (cache, zjednodušení).

## Fáze 6 – Rozšíření

- [ ] 6.1 Díl v otvoru jiného dílu (otvory jako další IFP).
- [ ] 6.2 Zbytky: uložit nevyužitý zbytek tabule jako novou tabuli do skladu
      a nabídnout ho při dalším výpočtu přednostně.

## Fáze 7 – Dokončení

- [ ] 7.1 Revize celého src/core subagentem revize-geometrie, opravy.
- [ ] 7.2 README česky: spuštění, formát CSV, podporované DXF entity,
      omezení, nasazení statického buildu (Coolify / libovolný web server).
- [ ] 7.3 Finální kontrola: lint, typecheck, test, e2e, build bez chyb
      a varování; push.

---

## Stav

Aktuální krok: 1.2
Poslední commit: chore: kostra projektu (krok 1.1)
BLOKOVÁNO: ne

## Odchylky

(sem Claude Code zapisuje rozhodnutí odlišná od plánu a proč)

- 1.1: TypeScript držen na 6.0.x, ne na aktuální 7.x – typescript-eslint 8.x
  podporuje jen TypeScript < 6.1.
- 1.1: Jeden `tsconfig.json` místo dělení app/node podle šablony Vite, aby
  `npm run typecheck` odpovídal `tsc --noEmit` z CLAUDE.md. Čistotu `src/core`
  hlídá ESLint (`no-restricted-imports` vč. `node:*` a `no-restricted-globals`
  pro DOM API).
- 1.1: Navíc nástrojové závislosti mimo seznam v plánu (vše MIT, ověří krok 1.2):
  @vitejs/plugin-react, typescript-eslint, @eslint/js, globals,
  eslint-plugin-react-hooks, eslint-plugin-react-refresh, eslint-config-prettier,
  @types/react, @types/react-dom, @types/node.
- 1.1: Repozitář byl založen `git init` (větev main); remote zatím není nastaven.
