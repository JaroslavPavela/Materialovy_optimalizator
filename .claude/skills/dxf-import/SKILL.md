---
name: dxf-import
description: Čtení DXF výkresů dílů – jednotky ($INSUNITS), entity LINE/ARC/CIRCLE/LWPOLYLINE s bulge/POLYLINE/ELLIPSE/SPLINE/INSERT, sestavení uzavřených kontur, otvory, tolerance a typické chyby výkresů z praxe. Použij při práci na src/core/import/dxf.ts, DXF fixtures nebo importu DXF v UI.
---

# DXF import

## Postup
1. `dxf-parser` → entity + hlavička + bloky.
2. Jednotky z `header.$INSUNITS` → měřítko na mm:
   0 = bez jednotek (předpokládat mm + varování), 1 = palce (25.4),
   2 = stopy (304.8), 4 = mm (1), 5 = cm (10), 6 = m (1000).
   Ostatní hodnoty → varování a mm.
3. Rozvinout `INSERT`: transformace bloku = měřítko (x, y), rotace,
   posun, s ohledem na bázový bod bloku; vnořené bloky rekurzivně
   (limit hloubky 8 proti cyklům). Pole (rows/columns) rozvinout.
4. Entity převést na segmenty (úsečka nebo oblouk), ignorovat
   TEXT, MTEXT, DIMENSION, HATCH, POINT, LEADER (započítat do varování).
5. Sestavit kontury, určit díly, normalizovat (viz níže).

## Entity
- **LINE**: úsečka.
- **ARC**: střed, poloměr, startAngle, endAngle (stupně, CCW). Pozor:
  dxf-parser může vracet úhly v radiánech – ověřit testem.
- **CIRCLE**: uzavřená kontura sama o sobě.
- **LWPOLYLINE / POLYLINE**: vrcholy + `bulge` mezi vrcholy
  (bulge = tan(θ/4), θ = středový úhel oblouku; kladný = CCW);
  příznak uzavření (flag 1 / `shape: true`).
- **ELLIPSE**: aproximovat polylinií (parametrické úhly start/end).
- **SPLINE**: aproximovat polylinií (de Boor nebo vyhodnocení podle
  kontrolních bodů a uzlů; když jsou k dispozici fitPoints, lze je použít).
- Pro výpočet nestingu aproximovat oblouky s chordální tolerancí 0,05 mm;
  původní oblouky uchovat pro náhled a export.

## Sestavení kontur
- Koncové body spojovat s tolerancí `JOIN_TOL = 0,01 mm` (konfigurovatelné).
  Použít prostorový index (mřížka) – výkresy mívají tisíce segmentů.
- Odstranit duplicitní segmenty (stejné body v toleranci, i obráceně).
- Sledovat řetězce, dokud se neuzavřou. Neuzavřená kontura → chyba
  s pozicí konců: „Kontura není uzavřená, mezera 0,8 mm u bodu (120,0; 35,5)".
  Mezery do 0,1 mm automaticky uzavřít s varováním.
- Výsledek: polygony (oblouky aproximované) + původní segmenty.

## Díly a otvory
- Kontura obsažená v jiné kontuře = otvor (test bod-v-polygonu pro bod
  ležící uvnitř, ne vrchol – může ležet na hraně). Kontura v otvoru =
  samostatný díl (vnořené díly).
- Režim „1 soubor = 1 díl": největší vnější kontura = díl, ostatní uvnitř = otvory;
  kontury mimo ni → varování.
- Režim „více dílů v souboru": každá vnější kontura = díl.
- Orientace: vnější CCW, otvory CW.
- Normalizace: posunout tak, aby levý dolní roh bbox byl v (0, 0).
- Název dílu: název souboru (bez přípony), u více dílů `soubor-1`, `soubor-2`.

## Typické problémy výkresů z praxe
Nespojené čáry (mezery v mikrometrech), překrývající se duplicitní čáry,
kóty a texty ve stejné vrstvě, výkres v palcích bez $INSUNITS,
díl vložený jako blok, uzavřená LWPOLYLINE s posledním bodem shodným
s prvním (nezdvojovat), oblouky s nulovým poloměrem, splajny z Inventoru.
Každý z nich má mít fixture v tests/fixtures/dxf/.
