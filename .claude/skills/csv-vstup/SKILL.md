---
name: csv-vstup
description: Formát vstupního CSV s díly a jeho robustní parsování (české exporty z Excelu – středník, desetinná čárka, Windows-1250, BOM) a validace s čísly řádků. Použij při práci na src/core/import/csv.ts, docs/format-csv.md, CSV fixtures nebo importu v UI.
---

# CSV vstup

## Sloupce
| Sloupec | Povinný | Typ | Poznámka |
|---|---|---|---|
| nazev | ano | text | neprázdný; duplicity povoleny, ID generuje aplikace |
| sirka | ano | číslo > 0 | mm |
| vyska | ano | číslo > 0 | mm |
| pocet | ano | celé číslo ≥ 1 | |
| material | ne | text | pro pozdější filtrování tabulí |
| tloustka | ne | číslo > 0 | mm |
| rotace | ne | `volne` / `90` / `180` / `zadna` | → `free` / `ortho` / `flip` / `locked`; výchozí `ortho` |

Hlavička:
- Rozpoznávat bez ohledu na velikost písmen, diakritiku a mezery
  (`Šířka`, `sirka`, `ŠÍŘKA (mm)` → `sirka`). Přijmout i anglické aliasy
  `name, width, height, qty|quantity|count, material, thickness, rotation`.
- Bez hlavičky: pokud první řádek obsahuje jen čísla ve 2.–4. sloupci,
  předpokládat pořadí `nazev; sirka; vyska; pocet`.

## Parsování
- Kódování: číst `ArrayBuffer`. BOM `EF BB BF` → UTF-8. Jinak zkusit
  `new TextDecoder('utf-8', { fatal: true })`; při výjimce
  `new TextDecoder('windows-1250')` (typický český Excel „CSV (oddělený středníkem)").
- Oddělovač: autodetekce z prvních ~5 řádků mezi `;`, `,`, `\t` – vybrat ten
  s konzistentním počtem sloupců > 1. Pozor: při `;` je čárka desetinný oddělovač.
- Papa Parse s `delimiter` z autodetekce, `skipEmptyLines: 'greedy'`.
- Čísla: odstranit mezery a nezlomitelné mezery (tisíce: `1 250,5`),
  čárku nahradit tečkou, pak `Number()`; `NaN` = chyba.
- Prázdné řádky a řádky jen s oddělovači ignorovat.

## Chyby
Parser nikdy nevyhazuje výjimku na špatná data – vrací
`{ parts, errors: { row, column?, message }[], warnings }`.
- `row` = číslo řádku v souboru (1 = hlavička), jak ho uvidí uživatel v Excelu.
- Zprávy česky a konkrétně: „Řádek 7: šířka „12,a" není číslo."
- Chybný řádek přeskočit, ostatní zpracovat.
- Varování: díl s nulovou plochou, extrémně velký počet (> 10 000), neznámý sloupec.

## Fixtures (tests/fixtures/csv/)
Vytvořit aspoň: `excel-cz-strednik-1250.csv` (bajty ve Windows-1250!),
`utf8-bom.csv`, `carka-tecka.csv` (oddělovač čárka, desetinná tečka),
`tabulator.tsv`, `bez-hlavicky.csv`, `chyby.csv` (nečíselné hodnoty,
záporné rozměry, chybějící počet), `anglicka-hlavicka.csv`, `velky-1000-dilu.csv`.
Soubory ve Windows-1250 generovat skriptem (Buffer s explicitními bajty),
ne editorem.
