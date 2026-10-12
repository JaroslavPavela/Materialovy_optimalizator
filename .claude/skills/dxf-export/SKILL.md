---
name: dxf-export
description: Zápis nářezového plánu do DXF pro CAM (R12 ASCII, vrstvy, zachování oblouků, jeden soubor na tabuli, ZIP) a další exporty (SVG, tisk/PDF, CSV). Použij při práci na src/core/export nebo exportním panelu v UI.
---

# Export

## DXF pro CAM
- Formát **R12 (AC1009) ASCII** – čte ho prakticky každý CAM i starší software.
  Proto `POLYLINE` + `VERTEX` + `SEQEND` (ne LWPOLYLINE), bulge ve VERTEX (kód 42).
- Minimální struktura: `HEADER` ($ACADVER = AC1009, $INSUNITS = 4 – mm,
  $EXTMIN/$EXTMAX), `TABLES` (LAYER pro každou vrstvu), `ENTITIES`, `EOF`.
  Bez BLOCKS, bez handles (R12 je nepotřebuje).
- Vrstvy a barvy (ACI): `TABULE` (8, šedá – obrys tabule), `DILY` (7 – vnější kontury),
  `OTVORY` (1, červená), `POPISKY` (3, zelená – TEXT s názvem dílu ve středu bbox).
- Geometrie z původních segmentů dílu (oblouky jako ARC nebo bulge),
  transformovaná podle umístění (rotace kolem referenčního bodu, pak posun).
  Při rotaci posunout i úhly oblouků; při rotaci o 180° neprohazovat start/end.
- Čísla zapisovat s tečkou, max. 6 desetinných míst, bez exponentu.
- Konce řádků `\r\n` (nejbezpečnější pro Windows CAM).
- Jeden soubor na tabuli: `<projekt>-tabule-01.dxf`. Všechny najednou jako ZIP (fflate).
- Test: zapsat → načíst dxf-parserem → počet entit a souřadnice sedí v EPS.

## SVG
- Viewbox v mm, osa Y převrácená transformací skupiny `scale(1,-1)` – text
  popisků převrátit zpět, aby nebyl zrcadlově.
- Barva výplně podle dílu (stabilní paleta podle hash ID), obrys tabule,
  okraj a zakázané zóny šrafované.

## Tisk / PDF
- Tiskové CSS (`@media print`, `@page { size: A4 landscape; margin: 10mm }`),
  jedna tabule na stránku (`break-after: page`), hlavička s projektem,
  formátem tabule a využitím, legenda dílů. PDF = tisk do PDF v prohlížeči.

## CSV výstup
Středník a desetinná čárka (otevře se v českém Excelu dvojklikem),
UTF-8 s BOM. Sloupce: `tabule; formát; díl; počet; šířka; výška; rotace`,
na konci souhrn: počet tabulí, celkové využití, neumístěné díly.
