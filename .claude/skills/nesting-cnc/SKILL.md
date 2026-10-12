---
name: nesting-cnc
description: Doménové znalosti pro algoritmy volného skládání dílů na tabule pro CNC (MaxRects, NFP, placer, genetický optimalizátor, rozestup, rotace, zakázané zóny, metriky). Použij při jakékoli práci v src/core/nesting, src/core/metrics.ts nebo src/worker.
---

# Nesting pro CNC – volné skládání

Žádné gilotinové řezy. Díly se smí skládat libovolně, jen se nesmí překrývat
a musí dodržet rozestup. Podrobnosti algoritmů: [reference/algoritmy.md](reference/algoritmy.md).

## Parametry a jejich geometrický význam
| Parametr | Význam | Implementace |
|---|---|---|
| rozestup `s` | min. vzdálenost dvou dílů (průměr nástroje + rezerva) | každý díl nafouknout o `s/2` |
| okraj `m` | nevyužitelný pruh po obvodu tabule | užitná plocha = tabule zmenšená o `m`, pak zvětšená o `s/2` (nafouknutý díl smí přesahovat okraj o `s/2`) |
| zakázaná zóna | obdélník/polygon, kam nesmí díl | nafouknout o `s/2`, pak brát jako obsazenou plochu / překážku |
| rotace | `free` (libovolný úhel, v praxi krok 90° pro obdélníky, pro tvary krok z nastavení, výchozí 90°), `ortho` (0/90/180/270), `flip` (0/180), `locked` (jen 0) | `flip`/`locked` existují kvůli směru povrchu (kartáčovaný plech, metalíza) |
| počet tabulí | každý formát má počet skladem (nebo neomezeno) | vyčerpaný formát už nepoužívat |

Pro obdélníkový režim (MaxRects) se z rotací uplatní jen 0° a 90°;
`flip` a `locked` znamenají v obdélníkovém režimu „bez otočení o 90°".

## Výsledek
`NestingResult` = seznam tabulí, každá s `Placement { partId, instance, x, y, rotation }`,
seznam neumístěných dílů s důvodem (`'větší než tabule'`, `'došly tabule'`)
a metriky. Souřadnice umístění = posun referenčního bodu dílu (levý dolní roh
bbox po rotaci) v mm, Y nahoru.

## Metriky
- využití tabule = Σ plocha dílů (skutečná, s otvory odečtenými) / plocha tabule
- celkové využití = Σ plocha dílů / Σ plocha použitých tabulí
- odpad = 1 − využití
- zbytek = největší volný osově rovnoběžný obdélník na poslední tabuli
  (u MaxRects přímo ze seznamu volných obdélníků)
- při porovnání dvou řešení: (1) méně neumístěných dílů, (2) méně tabulí,
  (3) větší zbytek na poslední tabuli, (4) vyšší využití

## Invarianty (vždy testovat property testy)
1. Žádné dva nafouknuté díly se nepřekrývají (plocha průniku < EPS²).
2. Každý nafouknutý díl leží v užitné ploše a neprotíná zakázanou zónu.
3. Každá instance dílu je buď umístěna právě jednou, nebo v seznamu neumístěných.
4. Rotace umístění je povolená pro daný díl.
5. Výpočet je deterministický pro dané vstupy a seed.

## Worker
- Jádro je čistá funkce `nest(input, options, onProgress?, signal?)`.
- Worker přes Comlink vystaví `nest`; průběh posílá přes `Comlink.proxy(callback)`,
  zrušení přes vlastní příznak kontrolovaný v cyklu (AbortSignal se do workeru nepřenáší).
- Optimalizátor posílá nejlepší dosavadní výsledek nejvýš ~4× za sekundu.
