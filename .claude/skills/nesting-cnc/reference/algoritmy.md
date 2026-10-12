# Algoritmy – podrobnosti

## MaxRects (obdélníky)
Udržuje seznam maximálních volných obdélníků (mohou se překrývat).

1. Start: jeden volný obdélník = užitná plocha. Zakázané zóny (nafouknuté)
   umístit jako obsazené – rozdělit jimi volné obdélníky.
2. Pro každý díl (nafouknutý o s/2) a každou povolenou orientaci (0°, 90°)
   najít nejlepší volný obdélník podle heuristiky:
   - **BSSF** (best short side fit): min(volnáŠ − š, volnáV − v), tie-break long side
   - **BLSF** (best long side fit): max(...) nejmenší
   - **BAF** (best area fit): nejmenší plocha volného obdélníku
   - **BL** (bottom-left): nejmenší y, pak x
3. Umístit, každý volný obdélník protínající umístěný díl rozdělit na až
   4 zbytky (vlevo, vpravo, dole, nahoře), pak odstranit obdélníky obsažené
   v jiném (prune). Pozor na složitost: prune je O(n²), u tisíců dílů
   průběžně čistit.
4. Pořadí dílů: zkusit řazení podle plochy, delší strany, obvodu, výšky
   (sestupně) × 4 heuristiky; vrátit nejlepší řešení podle kritérií ze SKILL.md.
5. Více tabulí: plnit tabuli, dokud se vejde něco ze zbývajících dílů,
   pak otevřít další (preferovat formát, na který se vejde nejvíc zbývající plochy).

Referenční popis: Jukka Jylänki, „A Thousand Ways to Pack the Bin" (2010).

## No-fit polygon (tvary)
- **NFP(A, B)** pro pevný A a pohyblivý B = množina pozic referenčního bodu B,
  kdy se B dotýká nebo překrývá A. Pozice mimo vnitřek NFP jsou přípustné.
- Výpočet: Minkowského součet A ⊕ (−B). Pro nekonvexní tvary použít
  Clipper `MinkowskiSum`/`MinkowskiDiff` (pracuje v celých číslech –
  souřadnice škálovat, např. ×1000 pro µm přesnost, a zpět).
- **IFP** (inner-fit polygon) = množina pozic referenčního bodu B, kdy B leží
  uvnitř užitné plochy. Pro obdélníkovou tabuli je to obdélník
  zmenšený o rozměry bbox(B).
- Přípustná oblast pro B = IFP − ⋃ NFP(umístěné díly, B) − ⋃ NFP(zakázané zóny, B)
  (rozdíl polygonů přes Clipper).
- Kandidátní pozice = vrcholy přípustné oblasti; vybrat podle kritéria
  (nejmenší x, pak y = „doleva", nebo gravitační centrum k rohu). Výchozí:
  minimalizace šířky obalového obdélníku všech umístěných dílů, tie-break y.
- Otvory dílu A: pro „díl v otvoru" (fáze 6) se otvor chová jako další IFP.
- Cache NFP podle klíče `${idA}:${rotA}|${idB}:${rotB}` – NFP závisí jen na tvarech a rotacích.

## Placer (bottom-left fill)
Pro díly v daném pořadí a s danou rotací: na aktuální tabuli spočítat
přípustnou oblast, vzít nejlepší vrchol; nevejde-li se, zkusit další
povolené rotace; jinak díl přesunout na další tabuli.

## Genetický optimalizátor (inspirace SVGnest, MIT)
- Jedinec = permutace instancí dílů + rotace každé instance.
- Fitness = počet tabulí × velká konstanta + (1 − využití poslední tabule)
  + penalizace za neumístěné díly.
- Populace ~10–30, výběr turnajem nebo vážený podle pořadí, křížení
  order crossover (OX) pro permutace, mutace = výměna dvou sousedů
  a/nebo změna rotace (pravděpodobnost ~10 %).
- Elitismus: nejlepší jedinec vždy přežije.
- Výchozí jedinec = díly seřazené podle plochy sestupně – zaručí, že
  výsledek nebude horší než jednoduchý placer.
- Ukončení: časový limit, uživatelské zastavení nebo N generací bez zlepšení.
- Seedovaný PRNG (např. mulberry32) kvůli reprodukovatelnosti testů.
