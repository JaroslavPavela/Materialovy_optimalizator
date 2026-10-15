# Závislosti a licence

Povolené licence: MIT, Apache-2.0, BSD, ISC, BSL-1.0 (Boost). GPL/AGPL nikdy.
Ověřeno 2026-10-12 příkazem `npm view <balík> license` a z `package.json`
nainstalovaných balíků.

## Běhové závislosti (jsou v buildu aplikace)

| Balík                  | Verze  | Licence                       | Účel                                  |
| ---------------------- | ------ | ----------------------------- | ------------------------------------- |
| react                  | 19.3.0 | MIT                           | UI                                    |
| react-dom              | 19.3.0 | MIT                           | UI                                    |
| zustand                | 5.0.15 | MIT                           | stav aplikace                         |
| papaparse              | 5.7.0  | MIT                           | čtení CSV                             |
| dxf-parser             | 1.1.2  | MIT                           | čtení DXF                             |
| clipper-lib            | 6.4.2  | BSL-1.0 (Boost Software Lic.) | offsety, Minkowského součet           |
| comlink                | 4.4.2  | Apache-2.0                    | Web Worker                            |
| dexie                  | 4.4.6  | Apache-2.0                    | IndexedDB                             |
| fflate                 | 0.8.3  | MIT                           | ZIP export                            |
| @node-projects/acad-ts | 3.3.0  | MIT                           | čtení DWG (načte se až u souboru DWG) |

`clipper-lib` má v `package.json` jen zkratku „BSL"; hlavička `clipper.js`
výslovně uvádí _Boost Software License Ver 1_ (ne Business Source License).

`@node-projects/acad-ts` (ověřeno 2026-10-15) je port C# knihovny ACadSharp
(MIT) do TypeScriptu, bez dalších závislostí. Zamítnuté alternativy pro DWG:
`@mlightcad/libredwg-web` a `libredwg-web-ts` (GPL – LibreDWG),
`@mlightcad/libdxfrw-web` (GPL-2.0), `dwg2dxf-converter` (v `package.json`
MIT, ale obsahuje LibreDWG pod GPL) a `dwgdxf` (MIT, ale obsahuje acadrust
pod MPL-2.0, která není mezi povolenými licencemi).

## Vývojové závislosti (nejsou v buildu)

| Balík                       | Verze   | Licence    |
| --------------------------- | ------- | ---------- |
| vite                        | 8.3.4   | MIT        |
| @vitejs/plugin-react        | 6.1.2   | MIT        |
| typescript                  | 6.0.3   | Apache-2.0 |
| vitest                      | 5.0.4   | MIT        |
| fast-check                  | 4.10.2  | MIT        |
| @playwright/test            | 1.64.0  | Apache-2.0 |
| eslint                      | 10.12.0 | MIT        |
| @eslint/js                  | 10.0.1  | MIT        |
| typescript-eslint           | 8.71.2  | MIT        |
| eslint-plugin-react-hooks   | 7.1.1   | MIT        |
| eslint-plugin-react-refresh | 0.5.7   | MIT        |
| eslint-config-prettier      | 10.1.8  | MIT        |
| globals                     | 17.13.0 | MIT        |
| prettier                    | 3.9.10  | MIT        |
| @types/react                | 19.3.0  | MIT        |
| @types/react-dom            | 19.3.0  | MIT        |
| @types/node                 | 22.20.5 | MIT        |
| @types/papaparse            | 5.5.2   | MIT        |
| @types/clipper-lib          | 6.4.0   | MIT        |

## Tranzitivní závislosti

Celkem 218 balíků v `package-lock.json`: MIT 164, Apache-2.0 21, ISC 10,
BSD-2/3-Clause 8, BSL 1, a dále tři licence mimo seznam, všechny jen
v nástrojích pro vývoj a build, ne v kódu aplikace:

| Balík                           | Licence       | Původ                                                    |
| ------------------------------- | ------------- | -------------------------------------------------------- |
| lightningcss (+ binárky pro OS) | MPL-2.0       | vite – zpracování CSS při buildu                         |
| caniuse-lite                    | CC-BY-4.0     | data prohlížečů (přes eslint-plugin-react-hooks → babel) |
| minimatch                       | BlueOak-1.0.0 | pomocná knihovna nástrojů (permisivní)                   |

Žádná závislost nemá licenci GPL ani AGPL.
