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
- [x] 1.2 Ověření licencí všech závislostí (`npm view <balík> license`),
      zápis do docs/zavislosti.md.
      Hotovo: tabulka balík – verze – licence, žádná nepovolená.
- [x] 1.3 Datový model `core/model.ts`: Part, Sheet, NestingParams,
      Placement, NestingResult, ForbiddenZone; rotace jako
      'free' | 'ortho' | 'flip' | 'locked'.
- [x] 1.4 Geometrie `core/geometry/`: Point, Polygon (vnější + otvory),
      plocha, orientace, bbox, rotace/posun, EPS, porovnání s tolerancí.
      Hotovo: jednotkové testy + property testy (rotace o 360° = identita,
      plocha nezávislá na posunu).

## Fáze 2 – CSV a obdélníkový nesting

- [x] 2.1 docs/format-csv.md + `core/import/csv.ts`: sloupce název, šířka,
      výška, počet, materiál, tloušťka, rotace (volitelné); autodetekce
      oddělovače (; , tab), desetinná čárka, UTF-8 s BOM i Windows-1250
      (TextDecoder), chyby s číslem řádku. Fixtures v tests/fixtures/csv/.
      Hotovo: testy na všechny fixtures včetně chybných vstupů.
- [x] 2.2 `core/nesting/maxrects.ts`: MaxRects s heuristikami BSSF, BLSF,
      BAF, BL; rotace podle dílu; rozestup (díl nafouknut o rozestup/2,
      užitná plocha = tabule − okraj + rozestup/2); zakázané zóny jako
      předobsazené oblasti; více formátů tabulí s počty skladem; zkusit
      kombinace heuristik a řazení, vrátit nejlepší výsledek.
      Hotovo: property testy – žádný překryv, vše v užitné ploše mimo
      zakázané zóny, rozestup dodržen, každý díl umístěn nebo nahlášen
      jako neumístitelný (např. větší než tabule).
- [x] 2.3 `core/metrics.ts`: využití po tabulích i celkem, odpad,
      největší volný obdélník (zbytek).
- [x] 2.4 Web Worker (Comlink): výpočet mimo UI vlákno, průběh, zrušení.
- [x] 2.5 UI: nahrání souboru (drag & drop), editovatelná tabulka dílů,
      nastavení tabulí (formáty, počty, okraj, zakázané zóny) a parametrů
      (rozestup, rotace), tlačítko Vypočítat, náhled v SVG (zoom, posun,
      popisky, barva podle dílu), přepínání tabulí, souhrn využití.
      Hotovo: průchod v `npm run dev` bez chyb v konzoli (ověřit Playwrightem).
- [x] 2.6 Úložiště (Dexie): automatické uložení posledního projektu,
      knihovna formátů tabulí, export/import projektu jako JSON.
- [x] 2.7 E2E test: nahraj fixture CSV → zobrazí se plán a využití > 0 %.

## Fáze 3 – Export

- [x] 3.1 `core/export/dxf-writer.ts`: DXF R12 ASCII (nejširší kompatibilita
      s CAM), vrstvy TABULE, DILY, OTVORY, POPISKY, oblouky zachovány jako
      ARC; jeden soubor na tabuli, všechny tabule jako ZIP (fflate).
      Hotovo: test „zapiš → přečti dxf-parserem → stejné souřadnice v EPS".
- [x] 3.2 SVG export a tisk/PDF přes tiskové CSS (A4/A3 na šířku,
      jedna tabule na stránku, legenda a souhrn).
- [x] 3.3 CSV výstup: seznam dílů po tabulích + souhrnný řádek.
- [x] 3.4 E2E: výpočet → stažení DXF, SVG a CSV proběhne bez chyby.

## Fáze 4 – Import DXF (umísťování přes obalový obdélník)

- [x] 4.1 `core/import/dxf.ts`: LINE, ARC, CIRCLE, LWPOLYLINE (bulge),
      POLYLINE, ELLIPSE, SPLINE (aproximace s tolerancí), INSERT (bloky
      s transformací); $INSUNITS → mm (chybí-li, předpoklad mm + varování);
      TEXT, DIMENSION, HATCH ignorovat.
- [x] 4.2 Sestavení kontur: spojení koncových bodů s tolerancí, odstranění
      duplicit, uzavření, rozpoznání vnější kontury a otvorů, sjednocení
      orientace. Neuzavřené kontury nahlásit srozumitelnou chybou.
- [x] 4.3 Díly z DXF: režim „1 soubor = 1 díl" i „více dílů v souboru"
      (každá vnější kontura = díl); počet zadán v tabulce dílů; nahrání
      více souborů najednou.
- [x] 4.4 Fixtures DXF: generované vlastním writerem + ručně psané okrajové
      případy (nespojené čáry, duplicity, palce, blok, díl s otvory, spline).
- [x] 4.5 Nesting přes obalový obdélník (MaxRects), v náhledu a exportu
      skutečný tvar dílu včetně otvorů a oblouků.
      Hotovo: E2E nahraj DXF → plán → export DXF; testy na všechny fixtures.

## Fáze 5 – Tvarový nesting

- [x] 5.1 Offset kontur o rozestup/2 (Clipper), zjednodušení polygonů,
      aproximace oblouků pro výpočet (export dál z původní geometrie).
- [x] 5.2 NFP díl–díl (Minkowského součet přes Clipper) a IFP (vnitřek
      užitné plochy tabule), zakázané zóny jako překážky; cache NFP podle
      (díl A, rotace A, díl B, rotace B).
- [x] 5.3 Placer: pro každý díl a povolené natočení nejnižší a nejlevější
      přípustná pozice; neumístitelné díly → další tabule.
- [x] 5.4 Optimalizátor: genetický algoritmus nad pořadím a natočením,
      časový limit, průběžné posílání nejlepšího výsledku do UI.
- [x] 5.5 Property testy: plocha průniku dvou dílů < EPS, vše uvnitř užitné
      plochy, vzdálenost dílů ≥ rozestup − EPS.
- [x] 5.6 UI: volba režimu (obdélníkový / tvarový), průběh, tlačítko
      „Zastavit a použít nejlepší".
- [x] 5.7 Výkon: benchmark 200 dílů / 10 různých tvarů; první výsledek
      do 5 s, výsledek tvarového režimu nesmí být horší než přes obalový
      obdélník. Při nesplnění optimalizovat (cache, zjednodušení).

## Fáze 6 – Rozšíření

- [x] 6.1 Díl v otvoru jiného dílu (otvory jako další IFP).
- [x] 6.2 Zbytky: uložit nevyužitý zbytek tabule jako novou tabuli do skladu
      a nabídnout ho při dalším výpočtu přednostně.

## Fáze 7 – Dokončení

- [x] 7.1 Revize celého src/core subagentem revize-geometrie, opravy.
- [x] 7.2 README česky: spuštění, formát CSV, podporované DXF entity,
      omezení, nasazení statického buildu (Coolify / libovolný web server).
- [x] 7.3 Finální kontrola: lint, typecheck, test, e2e, build bez chyb
      a varování; push.

---

## Stav

Aktuální krok: hotovo (všechny kroky odškrtnuty)
Poslední commit: fix: opravy z revize kroku 7.1 – zjednodušení oblouků, cache důvodů neumístění, IFP otvoru (krok 7.1)
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
- 1.2: Jako port Clipperu zvolen `clipper-lib` 6.4.2 (Boost Software License 1.0,
  jak uvádí plán) + typy `@types/clipper-lib` (MIT). Přidán i `@types/papaparse` (MIT).
- 1.2: Tranzitivně jsou přítomny `lightningcss` (MPL-2.0, přes vite),
  `caniuse-lite` (CC-BY-4.0) a `minimatch` (BlueOak-1.0.0). Nejde o GPL/AGPL
  a jsou jen v nástrojích buildu, ne v kódu aplikace – ponecháno, viz docs/zavislosti.md.
- 1.3: Typy `Point`, `Ring`, `Polygon`, `Rect`, `Contour` (vrcholy s bulge jako
  LWPOLYLINE – zachová oblouky pro export) a `EPS` vznikly v `core/geometry/`
  už v kroku 1.3, protože je model potřebuje; funkce nad nimi doplní krok 1.4.
- 1.3: Subagent `revize-geometrie` se načte až po restartu relace – revize
  proběhla obecným subagentem s jeho instrukcemi.
- 1.4: Podle revize kroku 1.3: `EPS` zvětšen z 1e-6 na 1e-3 mm, přidány
  `AREA_EPS` a `CLIPPER_SCALE` = 1e4; `Placement` definován jako transformace
  `p' = R·p + (x, y)` místo „levý dolní roh bbox po natočení" (upraven i skill
  nesting-cnc); krok volné rotace ≥ 1°. Zdůvodnění v
  docs/rozhodnuti/001-tolerance-a-umisteni.md.
- 1.4: Nad rámec kroku přidán `core/geometry/contour.ts` (střed a poloměr
  oblouku z bulge, plocha, orientace, obrácení a přesný bbox obrysu s oblouky) –
  potřebuje ho validace tvaru dílu v modelu.
- 1.4: `UnplacedReason` rozšířen o `no-matching-sheet` a `blocked`, přidáno
  pravidlo párování materiálu a tloušťky `sheetMatchesPart` (chybějící = libovolný).
- Konec fáze 1: push selhal – repozitář nemá nastavený remote
  („No configured push destination"). Remote musí nastavit uživatel
  (hook jeho přidání blokuje). Push není blokující, pokračuji.
- 2.1: Navíc podpora UTF-16 s BOM (Excel „Text v kódování Unicode") a
  volitelné sloupce materiál/tloušťka/rotace i u souboru bez hlavičky.
  Fixtures generuje `tests/fixtures/generate.mjs` (nepřepisuje existující).
- 1.4 (revize): Oblouk se sagitou ≤ EPS/10 se bere jako úsečka (šum v bulge
  z CAD dával střed ~10¹² mm daleko a chybu bbox 0,09 mm). Samoprůniky obrysů
  a zakázaných zón validace modelu nekontroluje – řeší import DXF v kroku 4.2.
- 2.2: Pořadí kritérií pro výběr nejlepšího výsledku: (1) menší plocha
  neumístěných kusů, (2) méně neumístěných, (3) menší plocha použitých tabulí,
  (4) méně tabulí, (5) větší zbytek na poslední tabuli (podle revize: plocha
  neumístěných před počtem). Skill uvádí počet tabulí před plochou; u více formátů je
  plocha (spotřeba materiálu) výstižnější, u jednoho formátu je to totéž.
- 2.2: V obdélníkovém režimu se zakázaná zóna bere jako její obalový obdélník
  (konzervativně); přesný tvar zóny využije tvarový režim (fáze 5).
- 2.2: Volba dalšího formátu tabule: zbytky přednostně, pak formát s největší
  umístěnou plochou, při shodě menší tabule.
- 2.3: Zbytek se počítá pro každou tabuli (ne jen poslední) jako největší volný
  obdélník MaxRects zmenšený o rozestup/2 – od dílů i zón drží celý rozestup.
  V tvarovém režimu (bez volných obdélníků) je zatím `null`.
- 2.4: Jádro poskytuje generátor `nestSteps` (průběh po krocích, čisté
  a synchronní); worker mezi kroky předá řízení smyčce událostí, aby přijal
  `stop()` – zastavení vrátí nejlepší dosavadní výsledek. Tvrdé zrušení
  (`abort`) ukončí worker a vytvoří nový. AbortSignal ani SharedArrayBuffer
  (vyžaduje hlavičky COOP/COEP) se nepoužívají.
- 2.4: Režim `shape` zatím počítá přes obalové obdélníky – tvarový nesting
  přijde ve fázi 5. Vitest nově spouští `tests/**/*.test.ts` (i tests/worker).
- 2.2 (revize): Formáty se skladem 0 se při určení důvodu neumístění
  nepočítají; vejde-li se díl jen na takový formát, důvod je „došly tabule".
- 2.5: Při více než 12 tabulích se místo záložek přepíná výběrem a šipkami
  (soubor s 10 tisíci kusy dá přes 1000 tabulí). Výsledek je uložen spolu se
  vstupem, ze kterého vznikl; po změně zadání UI upozorní, že plán je zastaralý.
- 2.5: Výkon: `velky-1000-dilu.csv` (10 389 kusů) trvá jeden krok MaxRects
  ~6 s v Node a ~9 s ve workeru prohlížeče, celý výpočet (16 kroků) přes 1,5 min.
  UI nezamrzá (nejdelší blokování hlavního vlákna ~0,2 s), zastavení funguje;
  optimalizace patří do kroku 5.7. Nad rámec kroku přidány testy store
  (tests/state) a E2E průchod UI (tests/e2e/ui.spec.ts); E2E s velkým souborem
  používá CSS lokátory – `getByRole` s názvem nad 8000 poli blokoval stránku.
- 2.6: Formát projektu a jeho ověření je v jádře (`core/project.ts`, verze 1,
  pole `format` odliší projekt od jiného JSON). Data z IndexedDB se při načtení
  ověřují stejně jako soubor – úložiště mohla zapsat starší verze aplikace.
  Kontroluje se jen struktura; hodnoty ověří až výpočet, aby šel načíst
  i rozpracovaný projekt. Chybějící parametry se doplní výchozími s varováním.
- 2.6: Dexie je za rozhraním `ProjectStorage`; synchronizaci se store testují
  jednotkové testy s úložištěm v paměti (bez fake-indexeddb), skutečnou
  IndexedDB ověřuje E2E (obnovení stránky). Ukládá se jen zadání (díly,
  tabule, parametry), ne výsledek. Knihovna formátů je společná pro projekty;
  formát se stejným názvem se při uložení přepíše.
- 2.7: E2E prochází pět CSV fixtures (UTF-8 s BOM, Windows-1250, čárka/tečka,
  tabulátor, UTF-16), ne jen jednu.
- Konec fáze 2: push opět selhal – repozitář stále nemá nastavený remote
  („No configured push destination"). Pokračuji.
- 3.1: Obrysy se ve výchozím stavu zapisují jako uzavřená POLYLINE s bulge
  (oblouky přesně, obrys je pro CAM jeden řetěz); volba `segments: 'lines-arcs'`
  zapíše jednotlivé LINE a ARC, plný kruh je v obou režimech CIRCLE. Zakázané
  zóny jdou na vrstvu TABULE. Text mimo ASCII se zapisuje jako \U+XXXX
  (R12 nemá UTF-8). Nad rámec kroku: `placedContours` v core/placed.ts
  (obrysy umístěného dílu s oblouky – využije i SVG a krok 4.5) a exportní
  panel v UI (DXF aktuální tabule, ZIP všech) s E2E testem stažení.
- 3.1 (revize): V režimu `lines-arcs` se segment se sagitou < EPS zapíše jako
  LINE a úhly ARC mají 12 desetinných míst (bulge 9) – téměř rovné oblouky
  z CAD mají poloměr 10⁶–10⁸ mm a zaokrouhlení úhlů na 6 míst posunulo konce
  oblouků až o 1 mm. Doplněna vrstva 0, styl STANDARD, zóny v $EXTMIN/$EXTMAX
  a zkrácení textu na 255 znaků. Název souboru a ZIP jsou společné
  v core/export/files.ts (použije i SVG a CSV).
- 3.2: SVG cesta obrysu (`contourPath`, oblouky jako příkaz A), barvy dílů
  a velikost popisků jsou v core/export/svg.ts a sdílí je i náhled v UI –
  náhled teď kreslí skutečné obrysy včetně otvorů a oblouků (část kroku 4.5).
  Barva podle pořadí dílu v zadání (zlatý úhel) místo hashe ID ze skillu –
  odstíny se nikdy neopakují u sousedních dílů. Tisk: souhrnná strana
  (využití, tabulky, neumístěné díly) + strana na tabuli s legendou; formát
  A4/A3 na šířku volí uživatel. Navíc ZIP všech SVG.
- 3.3: Díly stejného druhu a natočení na tabuli jsou sečtené v jednom řádku.
  Za seznamem prázdný řádek, souhrn (tabulí, využití, umístěno, neumístěno,
  odpad) a blok neumístěných dílů s důvodem. CRLF; text začínající = + - @
  dostane apostrof (ochrana proti vzorcům v Excelu).
- Konec fáze 3: push selhal – repozitář stále nemá nastavený remote. Pokračuji.
- 4.1: Výstupem kroku jsou segmenty (úsečka nebo oblouk jako bulge, ve WCS
  v mm); kontury z nich sestaví krok 4.2. Pro CIRCLE, ELLIPSE a SPLINE jsou
  v dxf-parseru vlastní obsluhy entit – původní ztrácí směr extruze (zrcadlené
  kružnice z rozvinů plechu) a váhy racionálních splajnů; HATCH, LEADER aj.
  mají obsluhu, která je jen přeskočí. Podporovaná normála OCS je ±Z, jiná
  se přeskočí s varováním. Oblouk v bloku s nestejnoměrným měřítkem se
  aproximuje úsečkami (je z něj elipsa). Elipsy a splajny: adaptivní
  aproximace s tolerancí 0,01 mm. Text souboru: UTF-8, jinak Windows-1250.
  Nad rámec kroku: `core/geometry/affine.ts` a `approximateSegment`
  v contour.ts (použije i krok 5.1).
- 4.2: `core/import/contours.ts`. Koncové body se shlukují mřížkou
  (JOIN_TOL 0,01 mm), duplicitní segmenty (i obrácené) se odstraní. Hrany mimo
  cykly (visící čáry) se před trasováním oříznou, aby nerozbily obrys; smyčka
  procházející uzlem dvakrát (dotyk rohem) se rozdělí. Mezery do 0,1 mm se
  uzavřou přichycením vrcholu (nejbližší konce první), větší jsou chyba
  s pozicí konců. Hlášení jsou zkrácená na 5 + souhrn. Vnoření podle
  bodu vnitřní kontury mimo hranici (aproximace oblouků 0,01 mm); sudá
  hloubka = vnější obrys (CCW), lichá = otvor (CW). Čára napříč obrysem
  mezi dvěma vrcholy (např. ohyb na stejné vrstvě) se nahlásí jako
  neuzavřená kontura – oddělení podle vrstev řeší až UI. Nad rámec:
  `pointInRing`, `pointRingDistance`, `pointSegmentDistance` (polygon.ts)
  a `contourToRing` (contour.ts).
- 4.1 (revize): Aproximace křivek kontroluje body ve ¼, ½ a ¾ úseku proti
  polovině tolerance (samotný střed u esovité kubiky podcenil odchylku 92×).
  Přeskakují se neviditelné entity a vypnuté/zamrzlé vrstvy; entity bloku
  na vrstvě 0 dědí vrstvu vložení. Entity, které dxf-parser neumí (MLINE,
  REGION, 3DSOLID…), se zjistí předběžným průchodem textu a nahlásí s radou
  rozložit je v CADu. Ochrana proti zaseknutí: úhly přes modulo, tolerance
  omezená na 0,0001–10 mm, limit 2 mil. segmentů a 100 000 kopií pole.
  Normála se bere jako ±Z jen do odchylky 1e-6 (i u ELLIPSE a SPLINE).
  Téměř plný oblouk (mezera ≤ EPS) je kruh. XREF se nahlásí.
- 4.2 (revize): Uzly se shlukují „podle lídra" (posun bodu ≤ JOIN_TOL; řetězové
  shlukování slilo hustou lomenou čáru do bodu). Téměř plný oblouk (> 180°,
  tětiva ≤ 2·GAP_TOL) se dělí na poloviny. Mezery se uzavírají slitím volného
  konce s jiným volným koncem, pak i s uzlem obrysu – před odstraněním čar
  mimo cykly; ty se hledají jako mosty grafu (Tarjan), takže spojka mezi
  obrysem a otvorem nezničí otvor. Uzel lichého stupně (čára přes obrys,
  sdílená hrana dvou dílů) = chyba „kontura se větví" a díl z komponenty
  nevznikne. Samoprůniky a křížení kontur = chyba s místem. Duplicity se
  porovnávají podle výšky oblouku. Vnoření testuje i středy segmentů.
  Známé omezení: kolineární čára překrývající část hrany se neslučuje –
  nahlásí se jako větvení.
- 4.3: `core/import/dxf-parts.ts`. Režim „1 soubor = 1 díl": největší vnější
  obrys, ostatní kontury (mimo něj i díly v jeho otvorech) se ignorují
  s varováním. Díly se pojmenují podle souboru, u více dílů `soubor-1…`
  shora dolů a zleva doprava; výchozí natočení 0/90/180/270°. Import CSV
  nahradí seznam dílů, DXF díly přidá (dávka: první CSV nahradí, zbytek
  přidá). Rozměry dílů z DXF v tabulce nejdou upravit (plynou z obrysu).
  Hlášení importu jsou po souborech, CSV s číslem řádku. Nad rámec:
  volitelný filtr vrstev `layer` v jádře (UI pro výběr vrstev zatím ne).
- 4.4: Vzorky generuje `tests/fixtures/generate-dxf.ts` (spouští se přímo
  `node`, Node 22 odstraní typy; proto v src/core nejsou parametrové
  vlastnosti konstruktoru). Dva vzorky zapisuje vlastní DXF writer (plán
  s DXF R12, POLYLINE i LINE/ARC), 15 je ručně skládaných okrajových případů.
  Vzorek `zrcadleny-oblouk.dxf` má chybou při tvorbě špatně zrcadlené úhly
  oblouků – vzorky se nesmí měnit, zůstal jako případ neuzavřených kontur
  a správný rozvin s normálou −Z je `zrcadleny-rozvin.dxf`. Test hlídá,
  že každý vzorek ve složce má očekávání.
- 4.5: Nesting přes obalový obdélník, náhled a export se skutečným tvarem
  vznikly už v krocích 3.1, 3.2 a 4.3 (`placedContours`, `placedPartPaths`);
  krok doplnil E2E: dva DXF najednou → výpočet → náhled s oblouky a otvory →
  export DXF → zpětný import dává stejné díly (plochy včetně otvorů).
- Konec fáze 4: push selhal – repozitář stále nemá nastavený remote. Pokračuji.
- 5.1: `core/geometry/clipper.ts` (obal clipper-lib: offset, sjednocení,
  rozdíl, průnik, Minkowského součet; mm × 1e4) a `core/nesting/shapes.ts`.
  Nafouknutí o s/2 + skutečnou odchylku aproximace dovnitř (tětivy oblouků
  0,05 mm jen u dílů s oblouky + naměřená chyba zjednodušení ≤ 0,02 mm).
  Offset s ostrými rohy (miter, MiterLimit 2 – velmi ostré rohy seříznuté
  tečně) vždy obsahuje přesné nafouknutí a obdélník nafoukne přesně na
  (w + s) × (h + s), takže díl „na dělení tabule" se vejde stejně jako
  v MaxRects. Zjednodušení obrysu je Ramer–Douglas–Peucker (`simplifyRing`
  v polygon.ts) místo Clipper CleanPolygon, u kterého se odchylka sčítá.
  Minkowského součet: Clipper vrací jen ∂A ⊕ ∂B, doplněno sjednocení
  s A + b0 a a0 + B (podle revize – bez a0 + B chyběl vnitřek, když je B
  větší než A). Zóny se před offsetem sjednotí.
- 5.2: `core/nesting/nfp.ts`. Referenční bod dílu B = jeho lokální počátek,
  NFP tedy přímo dává posun (x, y) z `Placement`. NFP se počítá z vnějších
  obrysů nafouknutých tvarů (otvory dílů až ve fázi 6 – konzervativní).
  IFP obdélníkové užitné plochy je přesný; díl přesně na míru dá pruh šířky
  EPS, aby ho booleovské operace neztratily. Zóny jsou překážky přes
  NFP(zóna, B) v souřadnicích tabule.
- 4.2 (revize 2): Mřížkové hledání průsečíků (degenerovalo na O(n²) při
  vzdálené entitě) nahradila kontrola přes plochy v Clipperu: samoprůnik =
  plocha sjednocení ≠ |orientovaná plocha| (odhalí i symetrickou osmičku),
  otvor musí ležet celý v obrysu, otvory ani materiál různých dílů se
  nepřekrývají (v toleranci JOIN_TOL × obvod). Shodný obrys nakreslený
  dvakrát s jiným dělením hran se sloučí s varováním. Díl, v jehož materiálu
  leží volný konec neuzavřené kontury, větvení nebo samoprůnik, se vynechá
  s chybou – nevznikne díl bez nedokresleného otvoru. Čára mezi dvěma
  uzavřenými obrysy (spojka) díl nezničí. Import DXF zatím běží v UI vlákně;
  přesun do workeru zvážit v kroku 5.7.
- 5.3: `core/nesting/placer.ts`. Kritérium „nejnižší a nejlevější" se
  porovnává podle obalového obdélníku umístěného nafouknutého dílu (ne podle
  referenčního bodu, který závisí na natočení). Výběr formátu další tabule
  a důvody neumístění jako v MaxRects. Tolerance skládání SLACK = EPS/2:
  NFP se zmenší a IFP zvětší o SLACK, jinak by díly přesně na míru (mezera
  nulové šířky) z přípustné oblasti zmizely; zvolený bod se pak přichytí
  zpět do přesného IFP (díl u kraje leží přesně na okraji). V tvarovém
  režimu `nestSteps` spustí placer a navíc všech 16 kombinací MaxRects
  a vrátí lepší – tvarový režim tak není horší než obalové obdélníky.
  Porovnání výsledků (`compareRectResults`) přijímá i výsledek bez volných
  obdélníků. Invarianty tvarového režimu: tests/core/nesting/invariants.ts.
- 5.2 (revize): Přípustná oblast se na tabuli drží průběžně pro každou
  dvojici (díl, natočení) – po umístění se odečte jen NFP nového dílu
  (200 dílů z 10 tvarů s natočením po 90°: 1,1 s místo ~18 s). Cache NFP
  podle relativního natočení (N² · R záznamů), normalizované úhly v klíči.
  Díl s natočením mimo násobky 90° se nafoukne se zaoblenými rohy (+ 0,03 mm
  rezerva na tětivy), ostatní s ostrými. SLACK = EPS/4 a zmenšení NFP se
  zaoblenými rohy (součet odchylek zůstane pod EPS); IFP dílu širšího než
  plocha o ≤ EPS souměrně.
- 5.4: `core/nesting/optimizer.ts` – jedinec = pořadí kusů + gen natočení
  (konkrétní, nebo „placer vybere nejlepší"); výchozí jedinec = placer podle
  plochy, OX křížení (natočení putuje s kusem), mutace prohozením sousedů
  a změnou natočení, turnaj, elitismus, mulberry32 se semínkem z parametrů.
  Výsledky se porovnávají stejně jako v MaxRects (lexikograficky, ne skalární
  fitness). Tvarový režim v `nestSteps`: nejdřív 16 kombinací MaxRects
  (rychlý první výsledek), pak GA do časového limitu / 30 generací bez
  zlepšení; průběh `fraction` (0–1) podle času. Determinismus platí pro
  stejné semínko a stejný počet kroků – s časovým limitem závisí počet
  generací na rychlosti stroje (testy používají `maxGenerations`).
- 5.3 (revize): Sjednocení v Clipperu nechávalo v NFP falešné mikrootvory
  a štěrbiny (1 jednotka Clipperu), zmenšení o SLACK je zvětšilo a placer
  do nich položil díl přes jiný díl nebo zónu (20–25 % náhodných běhů).
  Oprava: NFP se čistí morfologickým uzavřením (rozšíření o EPS/4 s ostrými
  rohy, zmenšení o EPS/4 + SLACK se zaoblenými) a placer každého kandidáta
  (seřazené „dole, vlevo") ověří skutečným průnikem nafouknutých tvarů se
  sousedy a zónami; vezme prvního platného (nejvýš 50). Počet vrcholů
  nafouknutého obrysu je omezen na 40 (konzervativní zjednodušení + offset
  o skutečnou odchylku) – Minkowského součet v Clipperu je kvadratický
  (NFP 68 × 68 vrcholů trval 450 ms). Kritérium zbytku: porovnávají-li se
  výsledky bez volných obdélníků MaxRects, použije se u obou volný pruh
  vpravo/nahoře na poslední tabuli. Kontrola invariantů v testech je
  přísnější (plocha průniku ≤ 1e-6 mm² po přesném nafouknutí o (s − EPS)/2).
  Případy z revize jsou nové vzorky tests/fixtures/nesting/.
- 5.5: tests/core/nesting/shape-properties.test.ts – náhodné hvězdicové
  tvary s oblouky a otvory (bez samoprůniků), všechny režimy natočení,
  kroky 30/45/90°, rozestup 0–8, okraj, sklad, zóny; placer (30 běhů)
  i optimalizátor (8 běhů). Kontrola nezávisle přes Clipper: průnik
  skutečných tvarů nafouknutých o (s − EPS)/2 ≤ 1e-6 mm² (tj. vzdálenost
  ≥ s − EPS), tvar v tabuli bez okraje (tolerance EPS), od zón ≥ s − EPS,
  každý kus právě jednou, natočení, sklad a materiál. Mimo sadu ověřeno
  200 dalších náhodných případů bez porušení.
- 5.6: Volba režimu a časový limit (v sekundách) jsou v panelu Parametry,
  průběh ukazuje procenta podle času; „Zastavit a použít nejlepší" existovalo
  od kroku 2.5. Build hlásí varování o bloku > 500 kB – řeší krok 7.3.
- 5.7: Benchmark `npm run bench` (tests/bench, mimo běžnou sadu): 200 dílů
  z 10 hvězdicových tvarů s oblouky – první výsledek 23 ms (MaxRects),
  tvarově 1 tabule / využití 41 % proti 2 tabulím / 21 % přes obalové
  obdélníky. Optimalizace: Minkowského součet přes konvexní rozklad
  (`core/geometry/minkowski.ts`: triangulace uší + Hertel–Mehlhorn, součet
  konvexních polygonů, sjednocení) místo Clipper MinkowskiSum (3–5× rychleji,
  Clipper zůstal jako záloha a reference v testech); odečítání NFP bez
  předchozího sjednocení (nonzero). Placer je generátor (krok po kusu) a GA
  i `nestSteps` jím propouštějí „tiky" nejvýš po 50 ms – časový limit
  i „Zastavit" fungují uprostřed vyhodnocení; výchozí jedinec doběhne vždy.
  Podle revize 5.4: turnaj bere rodiče z předchozí generace (bral z nové);
  pojistka kandidátů měří hloubku (tvary zmenšené o EPS/2, průnik ≤ 1e-6 mm²)
  a prochází všechny kandidáty; zjednodušení obrysu nejvýš 0,2 mm a strop
  64 vrcholů (dřív neomezená tolerance vyplnila hluboké konkávy hřebenů);
  pruh zbytku se počítá jednou na výsledek. Tolerance zaoblení u volně
  natáčených dílů je 0,05 mm (rezerva 0,15 mm na stranu) kvůli počtu vrcholů.
  Známá omezení: placer pro 200 dílů trvá ~10 s (s volnou rotací ~30 s),
  takže GA u velkých úloh stihne v limitu jen pár vyhodnocení; díl přesně
  na míru do zářezu jiného dílu se neumístí (štěrbinu nulové šířky odstraní
  už sjednocení v Minkowského součtu).
- Konec fáze 5: push selhal – repozitář stále nemá nastavený remote. Pokračuji.
- 6.1: Jen tvarový režim (MaxRects pracuje s obalovými obdélníky). IFP otvoru
  H pro díl B = (H − b0) − (∂H ⊕ (−B)); tažení po hranici přes konvexní obaly
  konvexních částí −B (`holeInnerFit` v minkowski.ts), cache podle
  relativního natočení. Po umístění dílu se z přípustné oblasti odečte jeho
  NFP (pokrývá i otvory) a přidají se IFP jeho otvorů posunuté na místo;
  dřív umístěné díly ani zóny v otvoru být nemohou. Otvor nafouknutého dílu
  je zmenšený o s/2, díl v něm nafouknutý o s/2 → odstup ≥ s. Pojistka
  kandidátů počítá s otvory umístěných dílů.
- 6.2: Zbytek tabule = obdélník už uvnitř užitné plochy s odstupem od dílů
  a zón, uloží se jako nová tabule projektu: okraj 0, sklad 1, příznak
  `remnant`, materiál a tloušťka z původní tabule; zbytky pod 50 mm se
  vynechají. Výsledky tvarového režimu nemají volné obdélníky MaxRects –
  zbytek je větší volný pruh vpravo/nahoře (`stripRemnant` v metrics.ts).
  Přednost zbytků při výběru tabule už měl MaxRects i placer. Ukládá se do
  seznamu tabulí projektu (ten se ukládá automaticky), ne do knihovny formátů.
- Konec fáze 6: push selhal – repozitář stále nemá nastavený remote. Pokračuji.
- 7.1: Celková revize jádra (revize-geometrie) a revize výkonu kroku 5.7.
  Opraveno: placer počítá v souřadnicích kolem středu užitné plochy (Clipper
  nad ~4,7 m byl 5–7× pomalejší); hledání polohy je generátor (`findSteps`) –
  řízení předá po natočení, po dávkách 16 překážek i po kusu, který se
  nevejde, takže „Zastavit" a časový limit reagují do zlomku sekundy (limit
  15 s končí v 15,0 s místo 19,7 s); Minkowského součet sjednocuje kaskádově
  (ozubení 24 zubů 0,07 s místo 30 s); `boundComplexity` nemění konvexní
  obrysy a nepoužije zjednodušení, které limitu 64 vrcholů nedosáhne (jen
  zvětšovalo rozestup o 0,2–0,4 mm); pojistka kandidátů má práh plochy
  1e-8 mm² (1e-6 propustil hrot zanořený o 2 µm); průběh tvarového režimu
  ukazuje nejvýš 99 %, dokud výpočet běží. Validace vstupu přesunuta do
  `core/validate.ts` (hlavní balík bez Clipperu): nejvýš 100 000 kusů,
  plocha zóny přes sjednocení, samoprůnik obrysu/otvoru a otvor mimo díl.
  DXF export: vrstva ZBYTEK (obdélník zbytku), escapování `%` a `\` v TEXT,
  výška popisku podle velikosti dílu. Popisky v SVG/DXF/náhledu leží
  v materiálu dílu (`labelSpot` – i u rámu a tvaru L). CSV import: hlavička
  se pozná jen při ≥ 2 známých sloupcích (nebo 1 bez čísel za ním). Zbytky
  se uloží jen jednou na výsledek a použité zbytkové tabule ubudou ze skladu.
  Import DXF běží ve workeru (velký výkres neblokuje UI).
  Přidány testy: ozubení a hřeben v Minkowského součtu s výkonovou
  pojistkou, rozdíl s překrývajícími se otvory NFP, limit uprostřed
  výchozího jedince, benchmark samotného tvarového placeru (200 dílů 5,5 s).
- 7.2: README navíc popisuje použití UI, režimy skládání, export DXF
  (vrstvy) a omezení; časy placeru změřeny po opravách 7.1 (200 dílů ~6 s,
  s volnou rotací po 45° ~28 s).
- 7.3: Lint, typecheck, 461 testů, 20 e2e testů a build bez chyb a varování
  (hlavní balík 406 kB, worker 183 kB). Test Minkowského součtu rozdělen na
  srovnání s Clipperem (menší tvary) a výkonovou pojistku (ozubení 24 zubů),
  aby nepadal na časovém limitu pod zátěží. Push selhal – repozitář nemá
  nastavený remote („No configured push destination"); remote a první push
  musí udělat uživatel.
- 7.1 (revize oprav): `boundComplexity` použije zjednodušení na mezi 0,2 mm
  i bez dosažení 64 vrcholů, ubere-li aspoň čtvrtinu vrcholů (tvar C
  s dlouhými oblouky byl po první opravě 4× pomalejší). Důvody neumístění
  se cachují v `ShapeContext` a počítají po krocích (dřív se při každém
  vyhodnocení GA synchronně hledala poloha na prázdné tabuli pro každý díl –
  až 3 s bez předání řízení). `holeInnerFit` vrátí prázdno bez výpočtu, je-li
  díl širší nebo vyšší než otvor (booleovské operace nechávaly falešné pruhy,
  které pak zamítala až pojistka kandidátů).
- Po fázi 7: uživatel nastavil remote `origin` (GitHub) a větev `main`
  je odeslaná a sleduje `origin/main`.
