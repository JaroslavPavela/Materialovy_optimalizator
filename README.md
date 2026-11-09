# Materiálový optimalizátor

Webová aplikace pro tvorbu nářezových plánů pro CNC (frézka, vysekávací lis).
Díly zadané v CSV (obdélníky) nebo DXF či DWG (skutečné tvary s oblouky a
otvory)
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

1. **Díly** – přetáhněte soubory CSV, DXF nebo DWG do pole _Díly z CSV, DXF
   nebo DWG_ (lze víc souborů najednou), nebo je přidejte ručně v tabulce
   dílů. CSV nahradí seznam dílů, díly z DXF a DWG se přidají. U každého dílu zadáte
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
   dosavadní plán. Volba _Seskupit stejné tabule_ (výchozí zapnuto) ukáže
   tabule se shodným rozmístěním jednou s počtem opakování (např. „× 10“);
   po vypnutí se vypíše každá tabule zvlášť. Přepínač _Jedna tabule /
   Všechny tabule_ ukáže přehled všech tabulí v mřížce (po 24, další
   tlačítkem); kliknutím na tabuli v přehledu se otevře samostatně.
5. **Export** – DXF jedné tabule nebo všech (ZIP), SVG, CSV seznam dílů,
   tisk / PDF (A4 nebo A3 na šířku, jedna tabule na stránku). Při seskupení
   se stejné tabule exportují jednou: počet opakování je v názvu souboru
   (`…-tabule-01-10x.dxf`), v CSV ve sloupcích _opakování_ a _počet celkem_
   a v tisku v záhlaví stránky. Nevyužité
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
_1 soubor = 1 díl_ vezme největší obrys a díl pojmenuje podle souboru. Režim
_více dílů v souboru_ udělá díl z každého vnějšího obrysu a pojmenuje ho
textem (TEXT, MTEXT, i v blocích), který leží uvnitř obrysu – při více
textech tím s největším písmem. Díly se stejným textem a stejným tvarem se
sloučí do jednoho řádku s počtem kusů; liší-li se tvar nebo natočení,
zůstanou zvlášť (`A12`, `A12-2`) s upozorněním. Díl bez textu dostane název
souboru s pořadím (`plech-1`, `plech-2`).

Neuzavřené kontury, větvení (čára přes obrys, ohyb ve stejné vrstvě),
samoprůniky a překrývající se obrysy se hlásí srozumitelnou chybou s místem
ve výkresu; díl, kterého se chyba týká, se nepoužije. Chyby a varování
importu výkresu se zobrazí v samostatném okně – po nahrání výkresu s chybami
se otevře samo, v panelu importu zůstane u souboru souhrn a tlačítko
_Zobrazit chyby a varování_, které okno otevře znovu.

### Hladiny výkresu

Po načtení DXF nebo DWG se v panelu importu zobrazí hladiny s geometrií
a u každé jde zvolit, jak se použije:

| Role          | Význam                                                                                                                                                               |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| vnější obrys  | výchozí – obrysy dílů; kontura uvnitř jiné je otvor (jako výše)                                                                                                      |
| vnitřní obrys | kontury jsou jen otvory; kontura mimo materiál dílu se ignoruje s varováním, kontura přesahující obrys díl vyřadí                                                    |
| přidej k dílu | geometrie (gravírování, ohyby, značky) i texty jedou s dílem do náhledu a exportu, skládání je nebere v úvahu; co neleží celé v obrysu dílu, se ignoruje s varováním |
| ignoruj       | hladina se nepoužije (ani její texty pro názvy dílů)                                                                                                                 |

Textové poznámky (TEXT, MTEXT) se přenáší z hladin „přidej k dílu", po
zaškrtnutí _Přenášet texty i z hladin obrysů_ i z hladin s obrysy (i text,
který díl pojmenoval). Text patří dílu, ve kterém leží celý (šířka textu se
odhaduje bez metrik písma). Zachová se natočení, výška, šířkový faktor
a zarovnání; víceřádkový MTEXT se rozdělí na řádky a jeho formátování
(písmo, barvy, zlomky) se ztratí s varováním. V exportu DXF jsou poznámky
jako TEXT na své hladině; CAM je zobrazí svým písmem.

Po změně role se díly ze všech načtených výkresů hned načtou znovu – bez
nového nahrání souboru. Ruční úpravy dílů (název, počet, natočení, materiál,
tloušťka) zůstanou; díly se párují podle polohy ve výkresu. Díl, který
uživatel odebral, se nevrátí. Volba se pamatuje podle názvu hladiny
a použije se i pro další výkresy. Výkresy samotné se do projektu neukládají –
po obnovení stránky je pro změnu rolí potřeba výkres nahrát znovu.

## Podporované DWG

Čtou se DWG z AutoCADu R14 až 2018 a novějších, které ukládají ve formátu
2018 (AC1014–AC1032). Výkres se v prohlížeči převede na DXF (knihovna
[acad-ts](https://github.com/node-projects/acad-ts), MIT) a dál se zpracuje
stejně jako DXF – platí tedy stejné entity, jednotky, sestavení obrysů
i hlášení. Formát R14 neukládá jednotky výkresu, předpokládají se mm
s varováním. Starší DWG (R13 a dřív) se nečtou; uložte je v CADu jako DXF
nebo novější DWG. Knihovna pro DWG (~0,8 MB) se stáhne až při prvním
souboru DWG.

## Export DXF

Verze se volí v panelu Export (aplikace si volbu pamatuje):

| Verze             | Kdy použít                                                                                                     |
| ----------------- | -------------------------------------------------------------------------------------------------------------- |
| DXF 2018 (AC1032) | výchozí – současný CAM a AutoCAD; text v UTF-8, vrstvy s původními názvy hladin včetně diakritiky a mezer      |
| DXF 2000 (AC1015) | starší CAM, který 2018 neotevře; vrstvy s původními názvy, znaky mimo ASCII zapsané jako `\U+XXXX`             |
| DXF R12 (AC1009)  | velmi starý CAM; názvy vrstev převedené na velká písmena bez diakritiky (`Gravír` → `GRAVIR`, nejvýš 31 znaků) |

Vrstvy ve všech verzích: `TABULE` (obrys tabule a zakázané zóny), `POPISKY`
(názvy dílů), `ZBYTEK` (obdélník využitelného zbytku tabule) a díly z DXF
a DWG na vrstvách podle původních hladin výkresu. Hladiny, které by splynuly
(i jen velikostí písmen) nebo se jmenují jako vrstvy exportu, dostanou
příponu `_2`, `_3`…; táž hladina má stejný název ve všech souborech exportu.
Díly z CSV a díly z hladin `0`, `DILY` nebo `OTVORY` jsou na vrstvách `DILY`
(vnější obrysy) a `OTVORY` (otvory); přidaná geometrie z hladiny 0 na `0`.
Obrysy jsou uzavřené křivky s oblouky (v 2000 a 2018 LWPOLYLINE, v R12
POLYLINE), plné kruhy CIRCLE, přidaná geometrie LINE a ARC, poznámky
a popisky TEXT. Jeden soubor na tabuli, všechny tabule v ZIP. G-kód ani
pořadí řezů se negenerují – to je úloha CAM. Verze 2000 a 2018 zapisuje
knihovna [acad-ts](https://github.com/node-projects/acad-ts) (MIT) se
strukturou jako z AutoCADu; při prvním exportu v těchto verzích se načte
(~0,8 MB, stejná jako pro čtení DWG).

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
- Atributy bloků (ATTRIB) se jako poznámky nepřenáší. Kopie dílu z výkresu přidaná tlačítkem „+ Přidat díl"
  se po změně rolí hladin nenačte znovu – ponechá si původní tvar.
- DWG čte knihovna třetí strany (reverzní inženýrství formátu). Některé
  objekty výkresu se přečíst nemusí – aplikace na to upozorní. Když díl
  z DWG chybí nebo nesedí, uložte výkres v CADu jako DXF.

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
