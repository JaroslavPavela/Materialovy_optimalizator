# Formát vstupního CSV

Seznam obdélníkových dílů, jeden díl na řádek. Všechny rozměry v mm.

## Sloupce

| Sloupec  | Povinný | Hodnota        | Poznámka                                    |
| -------- | ------- | -------------- | ------------------------------------------- |
| název    | ano     | text           | neprázdný; stejné názvy smí být víckrát     |
| šířka    | ano     | číslo > 0      | mm, osa X tabule při natočení 0°            |
| výška    | ano     | číslo > 0      | mm, osa Y tabule při natočení 0°            |
| počet    | ano     | celé číslo ≥ 1 | počet kusů                                  |
| materiál | ne      | text           | díl jde jen na tabuli ze stejného materiálu |
| tloušťka | ne      | číslo > 0      | mm                                          |
| rotace   | ne      | viz níže       | výchozí `90`                                |

Hodnoty sloupce rotace:

| Hodnota v CSV                         | Význam                                    |
| ------------------------------------- | ----------------------------------------- |
| `volne`, `volné`, `free`              | libovolné natočení (po kroku z nastavení) |
| `90`, `ortho`                         | 0°, 90°, 180°, 270°                       |
| `180`, `flip`                         | jen 0° a 180° (směr povrchu, vlákna)      |
| `zadna`, `žádná`, `ne`, `0`, `locked` | bez natáčení                              |
| prázdné                               | `90`                                      |

## Hlavička

První řádek může být hlavička. Názvy sloupců se rozpoznávají bez ohledu na
velikost písmen, diakritiku, mezery a jednotky v závorce
(`Šířka`, `sirka`, `ŠÍŘKA (mm)` jsou totéž). Pořadí sloupců je libovolné.

Rozpoznávané názvy:

| Sloupec  | Česky                       | Anglicky                  |
| -------- | --------------------------- | ------------------------- |
| název    | název, díl, popis, označení | name, part, description   |
| šířka    | šířka                       | width                     |
| výška    | výška                       | height                    |
| počet    | počet, ks, kusů, množství   | qty, quantity, count, pcs |
| materiál | materiál                    | material                  |
| tloušťka | tloušťka, tl                | thickness                 |
| rotace   | rotace, otáčení, natočení   | rotation                  |

Neznámý sloupec se ignoruje s varováním.

**Bez hlavičky:** když jsou na prvním řádku ve 2. až 4. sloupci čísla,
soubor se čte jako `název; šířka; výška; počet` a volitelně dál
`materiál; tloušťka; rotace`.

## Oddělovač, čísla a kódování

- Oddělovač se rozpozná sám: středník `;`, čárka `,` nebo tabulátor.
  Vybere se ten, který dává na prvních řádcích stejný počet sloupců.
- Desetinná čárka i tečka (`12,5` i `12.5`). Mezery jako oddělovač tisíců
  jsou povolené (`1 250,5`). Pokud je oddělovač čárka, desetinná čísla
  s čárkou musí být v uvozovkách (`"12,5"`).
- Kódování: UTF-8 (s BOM i bez), Windows-1250 (český Excel, „CSV
  (oddělený středníkem)") a UTF-16 s BOM (Excel, „Text v kódování Unicode").
- Prázdné řádky a řádky jen s oddělovači se přeskočí.

## Chyby a varování

Chybný řádek se přeskočí, ostatní se načtou. Každá chyba uvádí číslo řádku
tak, jak ho ukazuje Excel (1 = první řádek souboru), např.:

- `Řádek 7: šířka „12,a" není číslo.`
- `Řádek 9: výška musí být větší než 0 (je -5).`
- `Řádek 12: chybí počet.`

Varování (díl se načte): neznámý sloupec, počet nad 10 000 kusů.

## Příklad

```csv
název;šířka;výška;počet;materiál;tloušťka;rotace
Bok skříně;720;560;4;DTD dub;18;180
Police;764,5;520;6;DTD dub;18;90
Záda;1200;800;1;HDF;3;volne
```
