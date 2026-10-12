# 001 – Tolerance, měřítko Clipperu a definice umístění

Stav: přijato (krok 1.4, na základě revize kroku 1.3)

## Tolerance

| Konstanta       | Hodnota  | Význam                                            |
| --------------- | -------- | ------------------------------------------------- |
| `EPS`           | 1e-3 mm  | délky a souřadnice (1 µm)                         |
| `AREA_EPS`      | 1e-6 mm² | plochy (EPS²), degenerované obrysy                |
| `ANGLE_EPS`     | 1e-9 °   | úhly natočení                                     |
| `CLIPPER_SCALE` | 1e4      | mm → celá čísla pro Clipper (1 jednotka = 0,1 µm) |

Důvody:

- Kvantizace Clipperu je 0,5 / `CLIPPER_SCALE` = 5·10⁻⁵ mm na souřadnici.
  `EPS` musí být řádově větší, jinak by property testy z kroku 5.5
  („vzdálenost ≥ rozestup − EPS") padaly kvůli zaokrouhlení, ne kvůli chybě.
- 1 µm je o řád pod přesností CNC frézek i lisů (~0,01 mm), pro výrobu
  je tedy zanedbatelný.
- `clipper-lib` přechází na pomalou 128bitovou aritmetiku nad 2³⁰ ≈ 1,07·10⁹.
  Při měřítku 10⁴ se do rychlého rozsahu vejdou souřadnice do ±107 m,
  tabule jsou nejvýš jednotky metrů.

## Umístění dílu (`Placement`)

Bod dílu `p` v lokálních souřadnicích (obalový obdélník při 0° je
[0, šířka] × [0, výška]) přejde na tabuli do `p' = R(rotation)·p + (x, y)`:
nejdřív otočení CCW kolem lokálního počátku, pak posun.

Původní návrh („(x, y) = levý dolní roh obalového obdélníku po natočení")
byl nejednoznačný – obalový obdélník se liší podle toho, zda se počítá
z oblouků, z jejich aproximace nebo z dílu nafouknutého o rozestup.
U volných natočení by se pak exportovaný díl posunul proti spočítané pozici.
Transformace je jednoznačná. Algoritmy, které pracují s rohem obalového
obdélníku (MaxRects), převádějí roh na posun funkcí `translationForCorner`.

## Krok natočení

`freeRotationStep` ≥ 1° (`MIN_ROTATION_STEP`), tedy nejvýš 360 natočení
na díl – omezuje velikost cache NFP a dobu výpočtu.
