---
name: geometrie-testy
description: Jak testovat geometrické jádro – Vitest, property testy ve fast-check (generátory dílů a tabulí, invarianty nestingu), práce s tolerancí EPS a správa fixtures. Použij při psaní nebo opravě testů v tests/core a tests/e2e.
---

# Testy geometrie a nestingu

## Zásady
- Testy jádra importují jen z `src/core` – žádný DOM, běží v prostředí `node`.
- Porovnání čísel: `expect(a).toBeCloseTo(b, 6)` nebo vlastní `expectNear(a, b, EPS)`;
  body a polygony porovnávat pomocným `expectPolygonNear` (stejný počet vrcholů,
  cyklický posun povolen).
- Neprocházející test se nikdy „neopraví" oslabením aserce nebo změnou fixture.
- Každá opravená chyba dostane regresní test.

## Property testy (fast-check)
Generátory (v `tests/core/arbitraries.ts`):
- `arbRectPart`: šířka/výška 1–2000 mm (celá čísla i desetinná), počet 1–20, rotace.
- `arbSheet`: 500–4000 × 500–2000 mm, okraj 0–20, rozestup 0–10.
- `arbPolygonPart`: náhodný jednoduchý polygon – např. hvězdicový tvar kolem
  středu s náhodnými poloměry (zaručeně jednoduchý), volitelně s obdélníkovým otvorem.
- `arbForbiddenZones`: 0–3 obdélníky uvnitř tabule.

Invarianty pro každý výsledek `nest()`:
1. žádný překryv nafouknutých dílů (obdélníky: test intervalů s EPS;
   polygony: plocha průniku přes Clipper < EPS²),
2. vše uvnitř užitné plochy a mimo zakázané zóny,
3. vzdálenost dvou dílů ≥ rozestup − EPS,
4. počet umístěných + neumístěných instancí = Σ počet,
5. rotace povolená pro díl,
6. determinismus: dva běhy se stejným seedem dají stejný výsledek.

Nastavení: `fc.assert(prop, { numRuns: 200, seed })`; pro pomalé tvarové
testy `numRuns: 30` a časový limit optimalizátoru v ms. Při selhání si
fast-check vypíše seed a zmenšený protipříklad – ten přidat jako regresní test.

## Fixtures
- `tests/fixtures/csv/`, `tests/fixtures/dxf/` – existující soubory neměnit
  (hlídá hook), nové přidávat smíš.
- Generované fixtures (např. DXF vlastním writerem) vytvořit jednorázovým skriptem
  `tests/fixtures/generate.mjs` a výsledné soubory commitnout.

## E2E (Playwright)
- `page.setInputFiles` s fixture, čekat na text využití v souhrnu.
- Kontrolovat, že konzole prohlížeče nemá chyby (`page.on('console')`).
- Stahování ověřit přes `page.waitForEvent('download')`.
