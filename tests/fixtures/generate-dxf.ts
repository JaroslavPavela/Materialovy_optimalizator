// Jednorázový generátor vzorků DXF: `node tests/fixtures/generate-dxf.ts`.
// Existující soubory nepřepisuje (vzorky se po vytvoření nesmí měnit).
// Část vzorků zapisuje vlastní DXF writer (R12), část jsou ručně skládané
// okrajové případy z praxe. Očekávané výsledky: tests/core/import/fixtures.test.ts.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeSheetDxf } from '../../src/core/export/dxf-writer.ts';
import type { Part, Sheet } from '../../src/core/model.ts';
import {
  arc,
  circle,
  dxf,
  ent,
  line,
  lwpoly,
  rectPoly,
  type G,
} from '../core/import/dxf-builder.ts';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), 'dxf');

function write(name: string, text: string, eol: '\n' | '\r\n' = '\r\n') {
  const file = path.join(root, name);
  if (fs.existsSync(file)) {
    console.log(`přeskočeno (existuje): dxf/${name}`);
    return;
  }
  fs.writeFileSync(file, eol === '\n' ? text : text.replace(/\n/g, '\r\n'));
  console.log(`vytvořeno: dxf/${name}`);
}

const NEG_Z: G[] = [
  [210, 0],
  [220, 0],
  [230, -1],
];

// --- Vlastním writerem -------------------------------------------------------

/** Příruba „D": obdélník s půlkruhem, kruhový otvor a otvor s obloukem. */
const priruba: Part = {
  id: 'd',
  name: 'Příruba',
  width: 110,
  height: 60,
  quantity: 3,
  rotation: 'free',
  shape: {
    outer: [
      { x: 0, y: 0, bulge: 0 },
      { x: 80, y: 0, bulge: 1 },
      { x: 80, y: 60, bulge: 0 },
      { x: 0, y: 60, bulge: 0 },
    ],
    holes: [
      [
        { x: 20, y: 30, bulge: -1 },
        { x: 40, y: 30, bulge: -1 },
      ],
      [
        { x: 60, y: 20, bulge: 0 },
        { x: 60, y: 40, bulge: -0.5 },
        { x: 70, y: 40, bulge: 0 },
        { x: 70, y: 20, bulge: 0 },
      ],
    ],
  },
};
const bok: Part = { id: 'b', name: 'Bok', width: 200, height: 100, quantity: 1, rotation: 'ortho' };
const plech: Sheet = {
  id: 's',
  name: 'Plech 1000 × 500',
  width: 1000,
  height: 500,
  stock: null,
  margin: 10,
  forbiddenZones: [
    {
      id: 'z',
      polygon: [
        { x: 900, y: 0 },
        { x: 1000, y: 0 },
        { x: 1000, y: 60 },
        { x: 900, y: 60 },
      ],
    },
  ],
};
const plan = {
  sheetId: 's',
  placements: [
    { partId: 'd', instance: 0, x: 20, y: 20, rotation: 0 },
    { partId: 'd', instance: 1, x: 300, y: 50, rotation: 90 },
    { partId: 'd', instance: 2, x: 500, y: 300, rotation: 37.5 },
    { partId: 'b', instance: 0, x: 700, y: 200, rotation: 0 },
  ],
};
write('plan-polyline.dxf', writeSheetDxf(plech, plan, [priruba, bok]), '\n');
write(
  'plan-cary-oblouky.dxf',
  writeSheetDxf(plech, plan, [priruba, bok], { segments: 'lines-arcs' }),
  '\n',
);

// --- Ručně skládané okrajové případy -----------------------------------------

/** Obdélník 120 × 80 z úseček s mikromezerami (0,005 mm) a jednou mezerou 0,05 mm. */
write(
  'nespojene-cary.dxf',
  dxf({
    entities: [
      line(0, 0, 120, 0),
      line(120.004, 0.003, 120, 80),
      line(119.997, 80.002, 0, 80),
      line(0, 79.95, 0, 0.0),
    ],
  }),
);

/** Obdélník 100 × 50, hrany nakreslené dvakrát (i obráceně), kruh dvakrát. */
write(
  'duplicity.dxf',
  dxf({
    entities: [
      line(0, 0, 100, 0),
      line(100, 0, 100, 50),
      line(100, 50, 0, 50),
      line(0, 50, 0, 0),
      line(100, 0, 0, 0),
      line(100, 50, 100, 0),
      circle(50, 25, 10),
      circle(50, 25, 10),
    ],
  }),
);

/** Díl v palcích: 4" × 2" s otvorem ⌀ 0,5". */
write(
  'palce.dxf',
  dxf({ insunits: 1, entities: [rectPoly(0, 0, 4, 2), circle(1, 1, 0.25)] }),
);

/** Výkres bez $INSUNITS (předpoklad mm s varováním). */
write('bez-jednotek.dxf', dxf({ insunits: null, entities: [rectPoly(10, 10, 300, 150)] }));

/** Díl jako blok s bázovým bodem, vložený jednou otočený a zvětšený. */
write(
  'blok.dxf',
  dxf({
    blocks: [
      {
        name: 'KONZOLA',
        base: { x: 50, y: 0 },
        entities: [
          lwpoly([
            [0, 0],
            [100, 0],
            [100, 20],
            [20, 20],
            [20, 60],
            [0, 60],
          ]),
          circle(10, 10, 4),
        ],
      },
    ],
    entities: [ent('INSERT', [2, 'KONZOLA'], [10, 500], [20, 200], [30, 0], [41, 2], [42, 2], [50, 90])],
  }),
);

/** Deska s otvory: kruhy, drážka z LWPOLYLINE s bulge a čtvercový otvor. */
write(
  'dil-s-otvory.dxf',
  dxf({
    entities: [
      rectPoly(0, 0, 400, 250),
      circle(50, 50, 15),
      circle(350, 50, 15),
      circle(50, 200, 15),
      circle(350, 200, 15),
      lwpoly([
        [150, 110, 0],
        [250, 110, 1],
        [250, 140, 0],
        [150, 140, 1],
      ]),
      rectPoly(180, 180, 40, 40),
    ],
  }),
);

/** Obrys se splajnem (stupeň 3) jako horní hranou a eliptickým otvorem. */
write(
  'spline.dxf',
  dxf({
    entities: [
      line(0, 0, 200, 0),
      line(200, 0, 200, 50),
      ent(
        'SPLINE',
        [70, 8],
        [71, 3],
        [72, 8],
        [73, 4],
        [40, 0],
        [40, 0],
        [40, 0],
        [40, 0],
        [40, 1],
        [40, 1],
        [40, 1],
        [40, 1],
        [10, 200],
        [20, 50],
        [30, 0],
        [10, 140],
        [20, 120],
        [30, 0],
        [10, 60],
        [20, -10],
        [30, 0],
        [10, 0],
        [20, 50],
        [30, 0],
      ),
      line(0, 50, 0, 0),
      ent(
        'ELLIPSE',
        [10, 100],
        [20, 25],
        [30, 0],
        [11, 30],
        [21, 0],
        [31, 0],
        [40, 0.4],
        [41, 0],
        [42, 2 * Math.PI],
      ),
    ],
  }),
);

/** Více dílů v souboru, jeden z nich v otvoru jiného. */
write(
  'vice-dilu.dxf',
  dxf({
    entities: [
      rectPoly(0, 0, 300, 200),
      rectPoly(50, 50, 200, 100),
      circle(150, 100, 30),
      rectPoly(400, 0, 100, 100),
      circle(600, 50, 40),
    ],
  }),
);

/** Neuzavřená kontura (chybí hrana) a vedle platný díl. */
write(
  'neuzavrena.dxf',
  dxf({
    entities: [
      line(0, 0, 100, 0),
      line(100, 0, 100, 60),
      line(100, 60, 0, 60),
      rectPoly(200, 0, 50, 50),
    ],
  }),
);

/**
 * Pozor: úhly rohových oblouků jsou zrcadlené špatně (v OCS mají být o 90°
 * jinde), oblouky proto nenavazují na úsečky. Vzorek zůstává jako případ
 * „chybně zrcadlený výkres → neuzavřené kontury"; správný je
 * zrcadleny-rozvin.dxf níže.
 */
write(
  'zrcadleny-oblouk.dxf',
  dxf({
    entities: [
      // V OCS (−Z) se X zrcadlí: obdélník −200…0 × 0…100 se zaoblenými rohy r = 10.
      line(-10, 0, -190, 0),
      arc(190, 10, 10, 180, 270, ...NEG_Z),
      line(-200, 10, -200, 90),
      arc(190, 90, 10, 90, 180, ...NEG_Z),
      line(-190, 100, -10, 100),
      arc(10, 90, 10, 0, 90, ...NEG_Z),
      line(0, 90, 0, 10),
      arc(10, 10, 10, 270, 360, ...NEG_Z),
      circle(100, 50, 20, ...NEG_Z),
    ],
  }),
);

/** Díl s texty, kótou a šrafou ve stejné vrstvě. */
write(
  'texty-koty.dxf',
  dxf({
    entities: [
      rectPoly(0, 0, 150, 75),
      ent('TEXT', [10, 10], [20, 10], [30, 0], [40, 5], [1, 'Díl A']),
      ent('MTEXT', [10, 10], [20, 30], [30, 0], [40, 3], [1, 'Materiál S235']),
      ent('DIMENSION', [10, 0], [20, -10], [30, 0], [70, 0], [1, '150']),
      ent('HATCH', [10, 0], [20, 0], [30, 0], [2, 'ANSI31'], [70, 0], [71, 0], [91, 0]),
    ],
  }),
);

/** Uzavřená LWPOLYLINE, jejíž poslední bod opakuje první. */
write(
  'lwpolyline-zdvojeny-bod.dxf',
  dxf({
    entities: [
      lwpoly([
        [0, 0],
        [80, 0],
        [80, 40, 0.5],
        [0, 40],
        [0, 0],
      ]),
    ],
  }),
);

/** Oblouk s nulovým poloměrem vedle platného dílu. */
write(
  'nulovy-polomer.dxf',
  dxf({ entities: [arc(30, 30, 0, 0, 90), rectPoly(0, 0, 60, 60)] }),
);

/** Vrstvy: obrys, ohyb přes díl a rámeček na zamrzlé vrstvě. */
write(
  'vrstvy.dxf',
  dxf({
    layers: [{ name: 'OBRYS' }, { name: 'OHYB' }, { name: 'RAMECEK', flags: 1 }],
    entities: [
      rectPoly(0, 0, 200, 100, [8, 'OBRYS']),
      line(100, 0, 100, 100, [8, 'OHYB']),
      rectPoly(-50, -50, 300, 200, [8, 'RAMECEK']),
    ],
  }),
);

/**
 * Rozvin plechu jako ze SolidWorks: rohové oblouky a otvor s normálou −Z.
 * V OCS se X zrcadlí – obdélník −200…0 × 0…100 se zaoblenými rohy r = 10.
 */
write(
  'zrcadleny-rozvin.dxf',
  dxf({
    entities: [
      line(-10, 0, -190, 0),
      arc(190, 10, 10, 270, 360, ...NEG_Z),
      line(-200, 10, -200, 90),
      arc(190, 90, 10, 0, 90, ...NEG_Z),
      line(-190, 100, -10, 100),
      arc(10, 90, 10, 90, 180, ...NEG_Z),
      line(0, 90, 0, 10),
      arc(10, 10, 10, 180, 270, ...NEG_Z),
      circle(100, 50, 20, ...NEG_Z),
    ],
  }),
);
