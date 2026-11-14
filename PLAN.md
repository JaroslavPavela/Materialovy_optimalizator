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

## Fáze 8 – Import DWG (na přání uživatele)

- [x] 8.1 `core/import/dwg.ts`: DWG (AutoCAD R14–2018, AC1014–AC1032) přes
      knihovnu s povolenou licencí převést na DXF a zpracovat stejnou cestou
      jako DXF; starší a poškozené DWG srozumitelnou chybou. Import ve
      workeru, knihovna DWG se načte až u souboru DWG. UI přijímá `.dwg`.
      Hotovo: testy – DWG vzorky všech verzí dají stejné díly jako zdrojové
      DXF, výkres z AutoCADu dá stejné díly jako DXF uložené AutoCADem;
      E2E nahraj DWG → plán.
- [x] 8.2 Názvy dílů z textu: v režimu „více dílů v souboru" (DXF i DWG) se
      díl pojmenuje textem (TEXT, MTEXT, i v blocích) uvnitř obrysu – při více
      textech největší písmo; díly se stejným textem a tvarem se sloučí
      a sečte se počet, jiný tvar se stejným textem zůstane zvlášť
      s upozorněním. Režim „1 soubor = 1 díl" dál podle souboru.
      Hotovo: jednotkové a property testy, očekávání názvů ve vzorcích.
- [x] 8.3 Přehled všech tabulí: v náhledu plánu přepínač „Jedna tabule" /
      „Všechny tabule"; přehled ukáže všechny tabule (nebo skupiny shodných
      tabulí) se skutečnými tvary dílů, kliknutí tabuli otevře samostatně.
      Hotovo: E2E přepnutí → všechny tabule s díly → otevření tabule.
- [x] 8.4 Hladiny výkresu: po načtení DXF/DWG seznam hladin s rolí „vnější
      obrys" (výchozí, otvory podle vnoření), „vnitřní obrys" (jen otvory),
      „přidej k dílu" (geometrie jede s dílem, skládání ji nebere v úvahu),
      „ignoruj". Role platí pro všechny výkresy a pamatují se podle názvu
      hladiny; po změně role se výkresy načtou znovu bez nového nahrání
      a ruční úpravy dílů zůstanou. Export DXF zapíše geometrii dílů pod
      původními názvy hladin.
      Hotovo: jednotkové testy rolí, přiřazení přidané geometrie, sloučení
      po novém načtení a vrstev exportu; E2E výkres s hladinami → změna rolí
      → plán → export DXF s původními hladinami → role po obnovení stránky.
- [x] 8.5 Textové poznámky: texty (TEXT, MTEXT) z hladin „přidej k dílu",
      volitelně i z hladin obrysů, se přenesou s dílem do náhledu, SVG,
      tisku a exportu DXF (TEXT na původní hladině) – i text, který díl
      pojmenoval. MTEXT jako prosté řádky; natočení, výška, šířkový faktor
      a zarovnání zůstanou.
      Hotovo: jednotkové testy čtení, přiřazení, umístění a zápisu poznámek;
      E2E hladina s texty → přidej k dílu → náhled a export DXF s TEXT.
- [x] 8.6 Export DXF 2000 a 2018: volba verze v panelu Export (výchozí
      2018, pamatuje se), R12 beze změny; ve verzích 2000 a 2018 vrstvy
      s původními názvy hladin včetně diakritiky a mezer.
      Hotovo: zpětné čtení vlastním importem, dxf-parserem a čtečkou acad-ts;
      E2E stažení DXF a ZIP ve všech třech verzích.
- [x] 8.7 Chyby a varování importu DXF/DWG v modálním okně: po nahrání
      výkresu s chybami se otevře samo, v panelu importu zůstane souhrn
      souboru s tlačítkem, které okno otevře znovu. Hlášení CSV beze změny.
      Hotovo: E2E výkres s chybami → okno → zavřít (tlačítko, Esc) → znovu
      otevřít.

---

## Stav

Aktuální krok: hotovo (všechny kroky odškrtnuty)
Poslední commit: fix: opravy z code-review (po kroku 8.7)
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
- 8.1: Čtení DWG: `@node-projects/acad-ts` 3.3.0 (MIT, port ACadSharp do
  TypeScriptu), verze přišpendlená. Ostatní knihovny DWG pro prohlížeč jsou
  GPL (LibreDWG, libdxfrw) nebo obsahují acadrust pod MPL-2.0 – viz
  docs/zavislosti.md. DWG se převede na ASCII DXF a čte stávajícím
  `readDxf`, takže jednotky, entity, bloky, sestavení obrysů a hlášení jsou
  pro DXF i DWG společné. DWG se pozná podle hlavičky (`AC10xx`), ne podle
  přípony. acad-ts vybírá mapování entit podle `constructor.name` – build
  workeru proto má `keepNames` (worker +13 kB); minifikace bez něj rozbila
  čtení jen v produkčním buildu, hlídá to E2E. Knihovna je v samostatném
  bloku (~0,8 MB), který worker načte až u prvního DWG; hlavní balík beze
  změny. Metoda workeru `importDxf` přejmenována na `importDrawing`.
  Nalezená a opravená chyba DXF importu: dxf-parser se zacyklil na POLYLINE
  bez SEQEND (vlastní obsluha POLYLINE v dxf.ts). Vzorky: 7 DWG zapsaných
  acad-ts z DXF vzorků (každá verze R14–2018, `tests/fixtures/generate-dwg.ts`)
  a výkres z AutoCADu 2004 z repozitáře ACadSharp (MIT, 1,1 MB) – očekávání
  z DXF, které AutoCAD uložil ze stejného výkresu (21 dílů, shoda rozměrů,
  otvorů i ploch). Generátor obchází dvě chyby zápisu v acad-ts (POLYLINE
  bez vrcholů, ztráta uzavření u DXF R12) převodem na LWPOLYLINE.
  Generátor a vzorek `plan-polyline-ac1015.dwg` vznikly napoprvé s chybou;
  hook chránící vzorky je nedovolil opravit, uživatel je smazal a vytvořily
  se znovu opraveným generátorem. Kontrola: lint, typecheck, 500 testů,
  24 e2e a build bez chyb a varování.
- 8.2: Na přání uživatele (upřesnil volby: největší písmo, sloučit stejné
  díly, jen hromadný režim, počet kusů z textu nečíst). `readDxf` vrací
  i texty (`texts`: text bez formátovacích kódů, odhad středu, výška v mm);
  střed textu se odhaduje ze zarovnání a počtu znaků (0,6 × výška na znak).
  Text patří nejhlouběji vnořenému dílu, v jehož obrysu leží; text
  v materiálu má přednost před textem v otvoru. Stejný tvar = obrysy
  i otvory do 0,05 mm (vrcholy i body na hranách, mřížkový index hran),
  natočená kopie stejný tvar není – zůstane zvlášť (`A12-2`) s upozorněním.
  Vlastní obsluha TEXT/MTEXT v dxf-parseru (směr extruze, kódy 41, 71).
  Atributy bloků (ATTRIB) se pro název nepoužívají. Revize subagentem
  revize-geometrie našla 9 problémů (výkon u perforovaných plechů, text
  v otvoru, falešná shoda se zářezem, kolize názvů, MTEXT s −Z, kódy MTEXT,
  zrcadlený text) – opraveny, každý má regresní test. E2E exportu DXF
  počítá se sloučením dílů při zpětném importu (popisky v exportu jsou
  názvy dílů). Kontrola: lint, typecheck, 522 testů, 24 e2e, build.
- 8.3: Na přání uživatele (bez nového kroku v plánu na začátku – doplněn).
  Přehled respektuje volbu „Seskupit stejné tabule". Vykresluje se po 24
  tabulích, další přidá tlačítko (výsledek s 1387 tabulemi: přehled 0,36 s).
  Kreslení tabule je společné pro náhled i přehled (`SheetDrawing`); vzor
  šrafování zón má jedinečné ID (`useId`), proto už není v CSS. Volba
  zobrazení je ve store (`planView`, `openSheet`) a neukládá se do projektu.
- 8.4: Na přání uživatele (upřesnil: export pod původními názvy hladin,
  „přidej k dílu" bez vlivu na skládání, role společné pro všechny výkresy,
  výchozí role vnější obrys, role se pamatují). `core/import/layers.ts`
  (role, `layerRolesFromJson`), `PartShape.layers` (hladina obrysu a otvorů)
  a `PartShape.marks` (přidaná geometrie po hladinách, úsečky a oblouky).
  Kontura nese hladinu většiny svých segmentů. Kontura z hladiny „vnitřní
  obrys" se sudou hloubkou se vynechá (její potomci se vnoří o úroveň výš);
  zasahuje-li do materiálu dílu, díl se vyřadí s chybou. Přidaná geometrie
  patří nejhlouběji vnořenému dílu, v jehož obrysu leží celá (konce, střed,
  bez křížení hranice); v otvoru ležet smí. Díly se stejným textem se sloučí,
  jen mají-li i stejné hladiny otvorů a stejnou přidanou geometrii na stejném
  místě. Texty na hladině „ignoruj" díly nepojmenují; starý filtr `layer`
  na texty dál nepůsobí. Výkresy zůstávají v paměti (`LoadedDrawing`, neukládají
  se do projektu); po změně role se znovu načtou ve workeru a díly se
  spárují podle polohy ve výkresu (obalový obdélník, `origins`), ne podle
  názvu – názvy `soubor-N` se při změně rolí posouvají. Ruční úpravy se
  poznají porovnáním s posledním importem; odebraný díl se nevrátí, díl,
  který zmizel kvůli roli, se vrátí i s úpravami. Role se ukládají do
  IndexedDB (Dexie verze 2, tabulka `settings`) hned, bez prodlevy
  automatického ukládání – E2E odhalil, že při obnovení stránky do 400 ms
  od změny se role ztratily. Klíč polohy dílu obsahuje obalové obdélníky
  všech sloučených kopií a páruje se s tolerancí uzavřené mezery
  (GAP_TOL + JOIN_TOL); rozdělí-li se sloučený díl, úpravy dostanou obě
  části. Import souboru během nového načtení přidává k aktuálnímu stavu
  a při změně rolí během importu načte dávku znovu. Export: názvy hladin
  převedené na platné názvy R12, přípony `_2` při splynutí nebo shodě
  s vrstvou exportu; hladiny 0, DILY a OTVORY se převádí podle role (obrys →
  DILY, otvor → OTVORY, přidaná geometrie → 0), takže prostý výkres na
  hladině 0 i díly z dřívějšího exportu mají obrysy a otvory oddělené jako
  dřív. Přiřazení se počítá ze všech dílů – stejné ve všech souborech ZIP;
  v tabulce LAYER jsou jen vrstvy použité na tabuli. Barvy převzatých
  vrstev: obrys 7, otvor 1, přidaná geometrie 2. Změna chování: díly
  z DXF s pojmenovanými hladinami už nejsou na DILY/OTVORY (upraven E2E
  `dxf.spec.ts`). Revize subagentem revize-geometrie ve dvou kolech našla
  12 + 7 problémů (mj. přenos úprav na jiný díl při párování podle názvu,
  slučování dílů s jinou přidanou geometrií, souběh nového načtení s načtením
  projektu i s importem, nestejné názvy vrstev mezi tabulemi, gravír přes
  zářez tvaru U, hladina 0 exportovaná jako `0_2`); opraveny s regresními
  testy. Známá omezení: texty z hladin „přidej k dílu" se nepřenášejí;
  kopie dílu z výkresu (+ Přidat díl) se po změně rolí nenačte znovu. Párování
  polohy (`originsMatch`) je v lehkém `layers.ts` – import z `dxf-parts.ts`
  vtáhl do hlavního balíku čtení DXF s Clipperem (529 kB, varování buildu).
  Kontrola: lint, typecheck, 584 testů, 27 e2e, build bez varování (hlavní
  balík 426 kB).
- 8.5: Na přání uživatele (po prověření; upřesnil: export i náhled/SVG/tisk,
  přenášet i text, který díl pojmenoval, a volba pro texty z hladin obrysů –
  role se volí pro celou hladinu, poznámky na hladině obrysů by jinak nešly
  přenést). Řádek textu = `PartNote` (bod podle zarovnání TEXT 72/73,
  natočení, výška velkých písmen, šířkový faktor, pozpátku), převedený přes
  OCS a bloky: natočení podle obrazu osy X, výška podle zvětšení kolmo,
  šířkový faktor podle poměru, zrcadlení = pozpátku, vzhůru nohama = +180°
  a pozpátku. Zarovnaný a přizpůsobený text (72 = 3, 5) jde na střed
  úsečky 10–11 bez roztažení. MTEXT: řádky po rozteči 5/3 výšky zarovnané
  nahoru podle bodu připojení; formátování (kromě \\P a escapovaných znaků)
  se ztratí s jedním varováním. Text patří dílu, v jehož obrysu leží celý
  odhadnutý obdélník všech řádků (0,6 × výška na znak, jako odhad středu
  pro názvy). Seznam hladin ukazuje i hladiny jen s texty. Náhled a SVG:
  velikost písma = výška / 0,7 (jako popisky). Volba se ukládá hned do
  IndexedDB (`texty-z-obrysu`).
  Revize subagentem revize-geometrie našla 10 problémů; opraveno s testy:
  zrcadlený text (normála −Z, blok se záporným měřítkem) byl otočený o 180°
  – natočení je úhel obrazu −X; kopie s ručně posunutým popiskem se
  přestaly slučovat – poznámky se porovnávají jen texty (bez polohy, bez
  textu, který díl pojmenoval), sloučený díl má poznámky první kopie; text
  přes zářez tvaru U (kontrola křížení hran obdélníku s obrysem); obrys dílu
  se aproximuje jen u dílů, ke kterým se text blíží; MTEXT se zalamuje
  podle šířky rámečku (kód 41); `\~` a `\X` nejsou formátování; zarovnání
  dole v SVG pod dotahy (`text-after-edge`, obdélník + 0,3 výšky); texty
  z hladiny POPISKY (vlastní export) se volbou „texty z obrysů" nepřenáší –
  jen výslovně rolí „přidej k dílu". Ponecháno: hlášení „Přeskočeny entity
  bez geometrie dílu: TEXT" zůstává i u použitých textů (na jeho znění stojí
  testy vzorků); zarovnání odstavce MTEXT (`\pxqc;`) se nepřenáší.
  Opravena i chyba kroku 8.4: hromadná náhrada v CSS rozbila pravidlo
  `.sheet-card svg .part:hover`, takže v náhledu nefungovalo zvýraznění
  dílu pod myší.
- 8.6: Na přání uživatele (výchozí 2018, ve 2000/2018 původní názvy hladin).
  Výkres tabule sestavuje jednou `sheetDrawing` (prvky contour/segment/text,
  vrstvy, meze); R12 ho serializuje vlastním zapisovačem beze změny výstupu,
  2000 a 2018 knihovnou acad-ts (už v projektu kvůli DWG) – vlastní zápis
  R2000+ by vyžadoval celou strukturu objektů (identifikátory, BLOCK_RECORD,
  LAYOUT, slovníky) a nešel by tu ověřit v AutoCADu. acad-ts vybírá zápis
  tabulek podle `constructor.name`, proto export 2000/2018 běží ve workeru
  (build s keepNames) a je asynchronní; R12 dál přímo v UI. Verze 2000:
  kódová stránka ANSI_1252 a znaky mimo ASCII jako `\U+XXXX` (i v názvech
  vrstev, tak to dělá AutoCAD); import nově `\U+` dekóduje i v názvech
  vrstev. Verze 2018 v UTF-8. Názvy vrstev 2000+: zakázané znaky
  (< > / \ " : ; ? * | = a obrácený apostrof) a řídicí znaky jako `_`, nejvýš 255 znaků;
  kolize bez ohledu na velikost písmen (AutoCAD názvy nerozlišuje).
  Čtečka acad-ts dekóduje podle `$DWGCODEPAGE` i u DXF 2007+ (AutoCAD je čte
  vždy jako UTF-8) – testy jí ověřují strukturu a počty, diakritiku vlastní
  import a dxf-parser. Hlavička 2000/2018 nese časy vytvoření (`$TDCREATE`),
  takže dva exporty téhož nejsou bajtově shodné. `LayerNames` bez
  parametrových vlastností konstruktoru (jádro spouští i Node s odstraněním
  typů). Výchozí verze 2018 změnila očekávání E2E (formát R12 se ověřuje
  výslovnou volbou R12).
  Revize subagentem revize-geometrie (R12 proti HEAD: 54 z 57 souborů
  bajtově shodných, zbylé tři se liší jen tím, že vrstva poznámky s prázdným
  textem už není v tabulce LAYER) našla 4 významné a 10 drobných problémů;
  opraveno s testy: acad-ts u DXF 2000 tiše vynechá vrstvu s názvem nad
  31 znaků a obě verze vrstvu s čárkou – názvy pro 2000 se zkracují na 31
  znaků (znaky mimo BMP jako „_"), čárka je zakázaný znak a hlášení
  zapisovače (varování, chyba) export zastaví chybou místo tichého vynechání;
  export jedné tabule zapisoval všechny (teď jen vybranou skupinu);
  doplněna rozvržení Model a Layout1 (LAYOUT, ACAD_LAYOUT, odkaz z
  BLOCK_RECORD), $EXTMIN/$EXTMAX a přesnost čísel 9 míst bez exponentu;
  úhly ARC v [0, 360); text poznámek a popisků escapuje „%" a „\" jako R12;
  zrušený výpočet odmítne i čekající import a export (jinak by tlačítka DXF
  zůstala zablokovaná) a soubor ze starého výsledku se nestáhne. Neověřeno:
  otevření v AutoCADu / DWG TrueView (v prostředí nejsou) – struktura
  odpovídá zápisu ACadSharp, ověřují ji tolerantní čtečky (dxf-parser,
  acad-ts, vlastní import). Prázdné slovníky (ACAD_GROUP) acad-ts záměrně
  nezapisuje.
- 8.7: Na přání uživatele (upřesnil: chyby i varování, okno se otevře samo
  po importu výkresu s chybami, v panelu jen souhrn). Nativní `<dialog>`
  (`showModal`, zavření tlačítkem i Esc). Po změně role hladiny se okno samo
  neotevírá (při zkoušení rolí by překáželo), jeho obsah se ale aktualizuje;
  tlačítko je u každého souboru s chybami nebo varováními.
- Po kroku 8.7 (code-review): Na přání uživatele hloubkový code-review celé
  aplikace a oprava všech nálezů (jádro, import, export, store, úložiště, UI),
  každý s regresním testem; žádný nový krok plánu, rozsah beze změny.
  Hlavní změny v importu výkresů: mřížkový index obdélníků
  `core/geometry/rect-index.ts` pro hledání rodiče kontury, dílu k textu
  a k přidané geometrii (20 000 otvorů 20,8 s → 2,9 s, 20 000 dílů s textem
  28,6 s → 2,6 s, s gravírem 88,8 s → 3,5 s); mez souřadnic `MAX_COORD`
  (1 000 km) a výšky oblouku `MAX_SAGITTA` (1 km) – obří oblouk vyčerpal
  paměť; vlastní obsluha LWPOLYLINE (chybějící kód 90 shodil celý výkres;
  méně vrcholů, než entita uvádí, = chyba a entita se vynechá); MTEXT se pro
  přiřazení k dílu zalamuje podle rámečku; aproximace oblouků s poloměrem
  nad ~10⁸ mm (nulový krok úhlu) a obrysy se statisíci vrcholů (přetečení
  zásobníku). Výkres bez ukončení EOF se doplní a načte: je-li useknutý až za
  sekcí entit, jen s varováním; uprostřed entit se poslední (nejspíš neúplná)
  entita vynechá s chybou – useknutá uzavřená křivka by jinak tiše dala menší
  díl. Text, který není DXF, se za useknutý výkres nevydává.
  DWG: poškozená hlavička DWG 2004+ plnila v acad-ts pole do vyčerpání paměti
  workeru – čtení běží se stropem počtu `Array.prototype.push` (dočasný obal,
  po čtení se vrací původní); useknuté DWG R13–2000 čtečku zacyklilo – před
  čtením se ověří, že sekce z hlavičky leží v souboru. Zbytkové riziko:
  jiná nekonečná smyčka knihovny bez alokací by import dál zasekla (worker
  jde ukončit jen zrušením).
  Hlášení importu se skloňují podle počtu (`core/plural.ts`; „1 další
  kontura – ignorována", „5 dalších kontur – ignorovány") – změněná znění
  mají upravená očekávání v testech. CSV: řádek `sep=` z Excelu určí
  oddělovač; chybná uvozovka už nespojí zbytek souboru do jednoho pole
  (soubor se přečte bez zpracování uvozovek, s varováním) – doplněno
  v docs/format-csv.md. Genetický optimalizátor si pamatuje výsledky shodných
  jedinců (kusy téhož dílu jsou zaměnitelné), takže stejný sled dílů
  a natočení neskládá znovu.
  Revize subagentem revize-geometrie: 4 významné a 2 drobné nálezy
  (kvadratický regulární výraz při ořezu konce souboru, useknutá křivka,
  useknuté DWG R14/2000, obří oblouk, falešné varování o EOF, nekonečné
  obdélníky v indexu) – opraveny s testy.
  Kontrolní revize oprav: soubor useknutý v hlavičce nebo tabulkách dxf-parser
  zacyklil (čtení tabulky hladin) – sekce, ve které soubor bez EOF končí, se
  zjistí před čtením a takový soubor skončí chybou „soubor je neúplný";
  useknutí uvnitř bloků je také chyba (při sekci entit před bloky by vznikl
  díl bez otvoru).
  Kontrola: lint, typecheck, 680 testů, 28 e2e, build bez varování (hlavní
  balík 437 kB).
