# Materiálový optimalizátor

Webová aplikace pro tvorbu nářezových plánů pro CNC (frézka, vysekávací lis).
Díly zadané v CSV (obdélníky) nebo DXF (skutečné tvary s oblouky a otvory)
rozmístí na tabule s co nejlepším využitím materiálu a plán vyexportuje do
DXF pro CAM, SVG, CSV a tisku / PDF.

Běží celá v prohlížeči – bez serveru, bez účtů. Výpočet probíhá ve Web
Workeru, projekt se průběžně ukládá do prohlížeče (IndexedDB).

## Spuštění

Potřeba je Node.js 22 nebo novější.

```sh
npm install
npm run dev        # vývojový server, http://localhost:5173
```

Produkční build:

```sh
npm run build      # kontrola typů + build do složky dist/
npm run preview    # náhled buildu, http://localhost:4173
```

## Nasazení

Výsledek `npm run build` ve složce `dist/` je statický web (HTML, JS, CSS).
Stačí ho nahrát na libovolný webový server – nepotřebuje backend, databázi
ani zvláštní hlavičky (SharedArrayBuffer se nepoužívá).

- **Coolify:** nová aplikace typu _Static_ (nebo Nixpacks se statickým
  výstupem), build příkaz `npm run build`, publikovaná složka `dist`.
- **nginx / Apache / jiný server:** obsah `dist/` zkopírovat do kořene webu.
  Soubory `*.js` musí mít MIME typ `text/javascript` (výchozí u běžných
  serverů) – Web Worker se načítá jako ES modul.
- Build předpokládá nasazení do kořene domény. Pro podsložku (např.
  `https://firma.cz/narezy/`) nastavte `base: '/narezy/'` ve `vite.config.ts`
  a build zopakujte.

## Použití

1. **Díly** – přetáhněte soubory CSV nebo DXF do pole _Díly z CSV nebo DXF_
   (lze víc souborů najednou), nebo je přidejte ručně v tabulce dílů.
   CSV nahradí seznam dílů, díly z DXF se přidají. U každého dílu zadáte
   počet kusů a povolené natočení. Řádek _Hromadně_ nad tabulkou nastaví
   rotaci, počet, materiál nebo tloušťku všem dílům, nebo jen vybraným
   (zaškrtávací pole, Shift + klik vybere rozsah); vyplněná pole se použijí,
   prázdná zůstanou beze změny.
2. **Tabule** – formáty tabulí (rozměr, počet skladem, okraj, materiál,
   tloušťka) a zakázané zóny (např. upínky). Formáty lze uložit do knihovny
   a použít v dalších projektech.
3. **Parametry** – rozestup dílů (průměr nástroje + rezerva), krok volné
   rotace, režim skládání a u tvarového režimu časový limit.
4. **Vypočítat** – plán se zobrazí po tabulích (kolečko myši přibližuje,
   tažením se plán posouvá). Výpočet lze kdykoli zastavit a použít nejlepší
   dosavadní plán.
5. **Export** – DXF jedné tabule nebo všech (ZIP), SVG, CSV seznam dílů,
   tisk / PDF (A4 nebo A3 na šířku, jedna tabule na stránku). Nevyužité
   zbytky tabulí lze uložit do skladu – při dalším výpočtu se použijí
   přednostně.

Projekt jde uložit a načíst jako JSON (_Uložit jako JSON_, _Načíst JSON_).

### Režimy skládání

- **Obdélníkový** (MaxRects) – rychlý, díly skládá podle obalového
  obdélníku. Vhodný pro desky a obdélníkové díly.
- **Tvarový** (no-fit polygon + genetický algoritmus) – skládá podle
  skutečného obrysu, díly do sebe zapadají, malé díly se vkládají i do
  otvorů větších dílů. Nejdřív okamžitě vrátí obdélníkový výsledek, pak ho
  vylepšuje až do časového limitu; výsledek nikdy není horší než
  obdélníkový.

## Formát CSV

Podrobně v [docs/format-csv.md](docs/format-csv.md). Stručně: sloupce
_název, šířka, výška, počet_ a volitelně _materiál, tloušťka, rotace_;
oddělovač středník, čárka nebo tabulátor (rozpozná se sám); desetinná čárka
i tečka; kódování UTF-8 (i s BOM), Windows-1250 a UTF-16 z Excelu. Chyby se
hlásí s číslem řádku.

```csv
název;šířka;výška;počet;materiál;tloušťka;rotace
Bok;720;560;4;DTD;18;90
Police;764,5;300;2;DTD;18;
```

## Podporované DXF

Čtou se ASCII DXF (binární ne) libovolné verze; délky se převádí na mm
podle `$INSUNITS` (palce, stopy, cm, m, mm…; chybí-li, předpokládají se mm
s varováním).

| Entita                                         | Zpracování                                                       |
| ---------------------------------------------- | ---------------------------------------------------------------- |
| LINE, ARC, CIRCLE                              | přesně (oblouky zůstávají oblouky)                               |
| LWPOLYLINE, POLYLINE (2D, 3D)                  | včetně oblouků (bulge) a uzavření                                |
| ELLIPSE, SPLINE (i racionální)                 | aproximace s odchylkou 0,01 mm                                   |
| INSERT                                         | bloky s posunem, měřítkem, otočením, zrcadlením, poli a vnořením |
| TEXT, MTEXT, DIMENSION, HATCH, POINT, LEADER … | ignorují se (hlásí se)                                           |
| REGION, 3DSOLID, MLINE a jiné                  | nepodporované – rozložte je v CADu                               |

Uzavřené obrysy se sestaví z čar a oblouků: koncové body do 0,01 mm se
spojí, mezery do 0,1 mm se uzavřou s varováním, duplicitní čáry se
odstraní. Kontura uvnitř jiné je otvor, kontura v otvoru je samostatný díl.
Neviditelné entity a vypnuté či zamrzlé vrstvy se přeskočí. Režim
_1 soubor = 1 díl_ vezme největší obrys, režim _více dílů v souboru_ udělá
díl z každého vnějšího obrysu.

Neuzavřené kontury, větvení (čára přes obrys, ohyb ve stejné vrstvě),
samoprůniky a překrývající se obrysy se hlásí srozumitelnou chybou s místem
ve výkresu; díl, kterého se chyba týká, se nepoužije.

## Export DXF

DXF R12 (AC1009) ASCII v mm – přečte ho prakticky každý CAM. Vrstvy
`TABULE` (obrys tabule a zakázané zóny), `DILY` (vnější obrysy), `OTVORY`,
`POPISKY` (názvy dílů) a `ZBYTEK` (obdélník využitelného zbytku tabule). Obrysy jako uzavřené POLYLINE s oblouky (bulge),
plné kruhy jako CIRCLE. Jeden soubor na tabuli, všechny tabule v ZIP.
G-kód ani pořadí řezů se negenerují – to je úloha CAM.

## Omezení

- Pouze volné skládání pro CNC – gilotinové řezy ani společný řez sousedních
  hran se neřeší.
- Tvarový režim je výpočetně náročný: 200 dílů z 10 tvarů složí placer asi
  za 6 s (s volnou rotací po 45° asi za 30 s), u velkých úloh tak
  optimalizátor v limitu stihne jen několik pokusů. Obdélníkový výsledek je
  k dispozici okamžitě a výpočet jde kdykoli zastavit.
- Díl přesně na míru do zářezu jiného dílu (pero a drážka bez vůle) se
  v tvarovém režimu neumístí.
- Výkres s kolineární čárou překrývající část hrany obrysu se nahlásí jako
  chybný (větvení) – je potřeba ho v CADu vyčistit.
- Normála entit musí mířit v ose Z (±Z); entity v natočené rovině se
  přeskočí.

## Vývoj

```sh
npm run test       # jednotkové a property testy (Vitest + fast-check)
npm run e2e        # Playwright (spustí build a náhled)
npm run bench      # výkonový benchmark tvarového nestingu (desítky sekund)
npm run typecheck  # kontrola typů
npm run lint       # ESLint
npm run format     # Prettier
```

Struktura a konvence kódu jsou v [CLAUDE.md](CLAUDE.md), postup stavby
a zdůvodnění rozhodnutí v [PLAN.md](PLAN.md) (sekce _Odchylky_),
licence závislostí v [docs/zavislosti.md](docs/zavislosti.md).
