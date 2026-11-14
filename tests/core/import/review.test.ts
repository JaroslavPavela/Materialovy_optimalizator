import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildContours } from '../../../src/core/import/contours.ts';
import { partsFromDxf } from '../../../src/core/import/dxf-parts.ts';
import { MAX_COORD, readDxf } from '../../../src/core/import/dxf.ts';
import { arc, circle, dxf, ent, line, lwpoly, rectPoly, type G } from './dxf-builder.ts';

const multi = { mode: 'multi', idPrefix: 'd' } as const;
const single = { mode: 'single', idPrefix: 'd' } as const;

const text = (s: string, x: number, y: number, h: number, ...extra: G[]) =>
  ent('TEXT', [10, x], [20, y], [30, 0], [40, h], [1, s], ...extra);

/** Čtverec ze čtyř úseček, poslední s mezerou `gap` (uzavře se automaticky). */
const gappedSquare = (x: number, y: number, gap: number) => [
  line(x, y, x + 20, y),
  line(x + 20, y, x + 20, y + 20),
  line(x + 20, y + 20, x, y + 20),
  line(x, y + 20, x, y + gap),
];

describe('import výkresů – případy z code-review', () => {
  it('MTEXT zalomený podle rámečku pojmenuje díl, ve kterém leží', () => {
    // Nezalomený řádek by měl střed až v sousedním dílu.
    const r = partsFromDxf(
      'plech.dxf',
      dxf({
        entities: [
          rectPoly(0, 0, 40, 60),
          rectPoly(41, 0, 45, 60),
          ent(
            'MTEXT',
            [10, 5],
            [20, 55],
            [30, 0],
            [40, 5],
            [41, 34],
            [71, 1],
            [1, 'A12 levy bok dlouhy popis'],
          ),
        ],
      }),
      multi,
    );
    expect(r.errors).toEqual([]);
    expect(r.parts).toHaveLength(2);
    const named = r.parts.filter((p) => p.name.startsWith('A12'));
    expect(named).toHaveLength(1);
    expect(named[0]!.width).toBeCloseTo(40, 6);
  });

  it('samoprůnik kontury se 130 001 vrcholy je chyba, ne výjimka', () => {
    // Osmička: dvě smyčky s mnoha vrcholy, které se kříží v počátku.
    const n = 130_001;
    const pts: [number, number][] = [];
    for (let i = 0; i < n; i++) {
      const t = (2 * Math.PI * i) / n;
      pts.push([1000 * Math.sin(t), 500 * Math.sin(2 * t)]);
    }
    const segments = pts.map((p, i) => {
      const q = pts[(i + 1) % n]!;
      return { a: { x: p[0], y: p[1] }, b: { x: q[0], y: q[1] }, bulge: 0, layer: 'DIL' };
    });
    const r = buildContours(segments);
    expect(r.regions).toEqual([]);
    expect(r.errors.join()).toMatch(/protíná sama sebe/);
  });

  it('dlouhá hrana s nepatrným obloukem import nezasekne', () => {
    const r = partsFromDxf(
      'dlouhy.dxf',
      dxf({
        entities: [
          lwpoly([
            [0, 0, 1e-9],
            [400_000, 0],
            [400_000, 100],
            [0, 100],
          ]),
        ],
      }),
      multi,
    );
    expect(r.errors).toEqual([]);
    expect(r.parts).toHaveLength(1);
    expect(r.parts[0]!.width).toBeCloseTo(400_000, 3);
  });

  it('entity s neplatnými daty se přeskočí s varováním a zbytek se načte', () => {
    const r = readDxf(
      dxf({
        entities: [
          rectPoly(0, 0, 10, 10),
          ent('ARC', [10, 5], [20, 5], [30, 0], [40, 2]),
          ent(
            'ELLIPSE',
            [10, 5],
            [20, 5],
            [30, 0],
            [11, 0],
            [21, 0],
            [31, 0],
            [40, 0.5],
            [41, 0],
            [42, 6.283185307179586],
          ),
          ent('LINE', [10, 'abc'], [20, 0], [30, 0], [11, 5], [21, 5], [31, 0]),
          ent('LWPOLYLINE', [90, 0], [70, 1]),
          ent('LWPOLYLINE', [70, 1], [10, 20], [20, 0], [10, 30], [20, 0], [10, 30], [20, 10]),
          ent('INSERT', [2, 'constructor'], [10, 0], [20, 0], [30, 0]),
          ent('INSERT', [2, 'toString'], [10, 0], [20, 0], [30, 0]),
        ],
      }),
    );
    expect(r.ok).toBe(true);
    // Obdélník (4) + LWPOLYLINE bez kódu 90 (3 hrany).
    const usable = r.segments.filter((s) =>
      [s.a.x, s.a.y, s.b.x, s.b.y, s.bulge].every(Number.isFinite),
    );
    expect(usable).toHaveLength(r.segments.length);
    expect(r.segments.length).toBeGreaterThanOrEqual(7);
    const w = r.warnings.join('\n');
    expect(w).toMatch(/ELLIPSE s neplatnými parametry/);
    expect(w).toMatch(/LINE s neplatnými daty/);
    expect(w).toMatch(/LWPOLYLINE s méně než dvěma vrcholy/);
  });

  it('souřadnice mimo rozsah se přeskočí, díl v rozsahu zůstane', () => {
    const far = 10 * MAX_COORD;
    const r = partsFromDxf(
      'daleko.dxf',
      dxf({ entities: [rectPoly(0, 0, 30, 20), line(0, 0, far, far), circle(far, 0, 5)] }),
      multi,
    );
    expect(r.errors).toEqual([]);
    expect(r.parts).toHaveLength(1);
    expect(r.warnings.join()).toMatch(/dál než 1 000 km od počátku/);
  });

  it('prázdný soubor a soubor bez EOF', () => {
    for (const empty of ['', '  \r\n\n']) {
      const r = readDxf(empty);
      expect(r.ok).toBe(false);
      expect(r.errors).toEqual(['Soubor je prázdný.']);
    }
    const whole = dxf({ entities: [rectPoly(0, 0, 30, 20)] });
    expect(readDxf(whole).warnings.join()).not.toMatch(/EOF/);
    // Chybí jen ukončení (sekce entit je uzavřená) – celé i uprostřed dvojice.
    for (const cut of [whole.replace(/0\nEOF\n$/, ''), whole.replace(/EOF\n$/, '')]) {
      expect(cut).not.toBe(whole);
      const r = partsFromDxf('useknuty.dxf', cut, multi);
      expect(r.errors).toEqual([]);
      expect(r.parts).toHaveLength(1);
      expect(r.warnings.join()).toMatch(/nemá ukončení \(EOF\)/);
    }
    // Znaky za ukončením (Ctrl-Z ze starých exportů) nejsou useknutý soubor.
    for (const tail of ['\x1a', 'xyz\n']) {
      const r = partsFromDxf('ocas.dxf', whole + tail, multi);
      expect(r.parts).toHaveLength(1);
      expect([...r.errors, ...r.warnings].join()).not.toMatch(/EOF|usekn/);
    }
    // Text, který není DXF, se nevydává za useknutý výkres.
    const json = readDxf('{"a": 1}');
    expect(json.ok).toBe(false);
    expect(json.errors.join()).toMatch(/nelze přečíst/);
  });

  it('výkres useknutý uprostřed entit: poslední entita se vynechá s chybou', () => {
    const big: [number, number][] = Array.from({ length: 100 }, (_, i) => {
      const t = (2 * Math.PI * i) / 100;
      return [200 + 40 * Math.cos(t), 40 * Math.sin(t)];
    });
    const whole = dxf({ entities: [rectPoly(0, 0, 30, 20), lwpoly(big)] });
    const at = whole.indexOf('LWPOLYLINE', whole.indexOf('LWPOLYLINE') + 1);
    const lines = whole.slice(at).split('\n');
    // Po 37 vrcholech, po X bez Y, uprostřed hodnoty, hned po kódu 0 a za entitou.
    const vertex37 = lines.slice(0, 1 + 2 * 3 + 37 * 4).join('\n');
    const cuts = [
      `${vertex37}\n`,
      `${vertex37}\n10\n12.5\n`,
      `${vertex37}\n10\n12.5\n20\n4`,
      `${vertex37}\n0\n`,
      `${vertex37}\n10\n`,
    ];
    for (const cut of cuts) {
      const r = partsFromDxf('useknuty.dxf', whole.slice(0, at) + cut, multi);
      expect(r.errors.join()).toMatch(/useknutý uprostřed výkresu/);
      expect(r.warnings.join()).not.toMatch(/\(\d+\)/);
      // Jen celý obdélník – z useknuté křivky žádný (menší) díl.
      expect(r.parts.map((p) => [p.width, p.height])).toEqual([[30, 20]]);
    }
    // Useknutá POLYLINE bez SEQEND.
    const poly = [
      ...ent('POLYLINE', [66, 1], [70, 1]),
      ...big.slice(0, 30).flatMap(([x, y]) => ent('VERTEX', [10, x], [20, y], [30, 0])),
    ];
    const cutPoly = dxf({ entities: [rectPoly(0, 0, 30, 20), poly] }).replace(
      /0\nENDSEC\n0\nEOF\n$/,
      '',
    );
    const r = partsFromDxf('polyline.dxf', cutPoly, multi);
    expect(r.errors.join()).toMatch(/useknutý uprostřed výkresu/);
    expect(r.parts.map((p) => [p.width, p.height])).toEqual([[30, 20]]);
    // Useknutí uvnitř bloků: srozumitelná chyba, ne interní hlášení parseru.
    const inBlock = dxf({
      blocks: [{ name: 'B', entities: [rectPoly(0, 0, 30, 20)] }],
      entities: [],
    });
    const cutBlock = partsFromDxf('blok.dxf', inBlock.slice(0, inBlock.indexOf('ENDBLK')), multi);
    expect(cutBlock.parts).toEqual([]);
    expect(cutBlock.errors.join()).toMatch(/useknutý uprostřed bloků/);
    // Sekce entit před bloky: useknutý blok nesmí dát díl bez otvoru.
    const withHole = dxf({
      blocks: [{ name: 'B', entities: [rectPoly(0, 0, 120, 200), circle(60, 100, 20)] }],
      entities: [ent('INSERT', [2, 'B'], [10, 0], [20, 0])],
    });
    const blocksAt = withHole.indexOf('0\nSECTION\n2\nBLOCKS');
    const entitiesAt = withHole.indexOf('0\nSECTION\n2\nENTITIES');
    const eofAt = withHole.lastIndexOf('0\nEOF');
    expect(blocksAt).toBeGreaterThanOrEqual(0);
    expect(entitiesAt).toBeGreaterThan(blocksAt);
    const swapped =
      withHole.slice(0, blocksAt) +
      withHole.slice(entitiesAt, eofAt) +
      withHole.slice(blocksAt, entitiesAt) +
      withHole.slice(eofAt);
    const full = partsFromDxf('blok.dxf', swapped, multi);
    expect(full.errors).toEqual([]);
    expect(full.parts).toHaveLength(1);
    const circleAt = swapped.lastIndexOf('CIRCLE');
    for (const at of [circleAt - 2, circleAt + 7, swapped.indexOf('ENDBLK', circleAt) - 2]) {
      const r = partsFromDxf('blok.dxf', swapped.slice(0, at), multi);
      expect(r.parts).toEqual([]);
      expect(r.errors.join()).toMatch(/useknutý uprostřed bloků/);
    }
  });

  it('výkres useknutý v hlavičce nebo tabulkách skončí chybou, nezasekne se', () => {
    for (const name of ['plan-cary-oblouky.dxf', 'vrstvy.dxf']) {
      const text = readFileSync(`tests/fixtures/dxf/${name}`, 'latin1');
      const from = text.indexOf('TABLES');
      const to = text.indexOf('ENDSEC', from);
      expect(from).toBeGreaterThan(0);
      expect(to).toBeGreaterThan(from);
      for (let at = from + 8; at < to; at += 7) {
        const r = readDxf(text.slice(0, at));
        expect(r.ok).toBe(false);
        expect(r.errors.join()).toMatch(/soubor je neúplný/);
      }
    }
  });

  it('LWPOLYLINE s méně vrcholy, než uvádí, se vynechá i v úplném souboru', () => {
    const short = lwpoly([
      [100, 0],
      [140, 0],
      [140, 40],
    ]).map((g): G => (g[0] === 90 ? [90, 8] : g));
    const r = partsFromDxf('kratka.dxf', dxf({ entities: [rectPoly(0, 0, 30, 20), short] }), multi);
    expect(r.errors.join()).toMatch(/méně vrcholů, než sama uvádí/);
    expect(r.parts.map((p) => [p.width, p.height])).toEqual([[30, 20]]);
  });

  it('obří oblouk a kružnice se přeskočí bez vyčerpání paměti', () => {
    const start = performance.now();
    const huge = [
      lwpoly([
        [-1e7, 0, 1000],
        [1e7, 0, 1000],
      ]),
      lwpoly([
        [0, 0, 1000],
        [1.8e9, 0, 1000],
      ]),
      circle(0, 0, 9e8),
    ];
    for (const e of huge) {
      const r = partsFromDxf('obr.dxf', dxf({ entities: [rectPoly(0, 0, 30, 20), e] }), multi);
      expect(r.parts.map((p) => [p.width, p.height])).toEqual([[30, 20]]);
      expect(r.warnings.join()).toMatch(/vyšší než 1 km|dál než 1 000 km/);
    }
    // Téměř rovný oblouk s obřím poloměrem (běžný šum z CADu) zůstává.
    const flat = partsFromDxf(
      'rovny.dxf',
      dxf({
        entities: [
          lwpoly([
            [0, 0, 1e-7],
            [3000, 0],
            [3000, 1500],
            [0, 1500],
          ]),
        ],
      }),
      multi,
    );
    expect(flat.parts).toHaveLength(1);
    expect(flat.warnings.join()).not.toMatch(/1 km/);
    expect(performance.now() - start).toBeLessThan(5000);
  });

  it('dlouhý běh prázdných řádků před ukončením nezdrží čtení', () => {
    const whole = dxf({ entities: [rectPoly(0, 0, 30, 20)] });
    const padded = whole.replace(/0\nEOF\n$/, `${'\n'.repeat(200_000)}0\nEOF\n`);
    const start = performance.now();
    readDxf(padded);
    readDxf(`${' '.repeat(200_000)}\n${whole}`);
    expect(performance.now() - start).toBeLessThan(3000);
  });

  it('1 soubor = 1 díl: vnořená kontura vedlejšího dílu není „uvnitř otvorů"', () => {
    // Hlavní díl bez otvorů; vedle díl s otvorem a dílkem v něm.
    const r = partsFromDxf(
      'jeden.dxf',
      dxf({
        entities: [
          rectPoly(0, 0, 500, 500),
          rectPoly(600, 0, 100, 100),
          rectPoly(620, 20, 60, 60),
          rectPoly(640, 40, 10, 10),
        ],
      }),
      single,
    );
    expect(r.parts).toHaveLength(1);
    expect(r.parts[0]!.shape!.holes).toEqual([]);
    const w = r.warnings.join('\n');
    expect(w).not.toMatch(/Uvnitř otvorů/);
    expect(w).toMatch(/Mimo hlavní obrys jsou 2 další kontury – ignorovány/);
  });

  it('1 soubor = 1 díl: díl v otvoru hlavního dílu se dál hlásí jako uvnitř', () => {
    const r = partsFromDxf(
      'jeden.dxf',
      dxf({
        entities: [
          rectPoly(0, 0, 500, 500),
          rectPoly(100, 100, 200, 200),
          rectPoly(150, 150, 20, 20),
        ],
      }),
      single,
    );
    const w = r.warnings.join('\n');
    expect(w).toMatch(/Uvnitř otvorů dílu je 1 další kontura – ignorována/);
    expect(w).not.toMatch(/Mimo hlavní obrys/);
  });

  it('hlášení se skloňují podle počtu', () => {
    const outside = (n: number) =>
      partsFromDxf(
        'jeden.dxf',
        dxf({
          entities: [
            rectPoly(0, 0, 500, 500),
            ...Array.from({ length: n }, (_, i) => rectPoly(600 + 30 * i, 0, 20, 20)),
          ],
        }),
        single,
      ).warnings.join('\n');
    expect(outside(1)).toMatch(/Mimo hlavní obrys je 1 další kontura – ignorována/);
    expect(outside(3)).toMatch(/Mimo hlavní obrys jsou 3 další kontury – ignorovány/);
    expect(outside(5)).toMatch(/Mimo hlavní obrys je 5 dalších kontur – ignorovány/);

    const attach = { ...multi, layerRoles: new Map([['G', 'attach' as const]]) };
    const stray = (n: number) =>
      partsFromDxf(
        'gravir.dxf',
        dxf({
          entities: [
            rectPoly(0, 0, 50, 50),
            ...Array.from({ length: n }, (_, i) => line(100, 10 * i, 120, 10 * i, [8, 'G'])),
            ...Array.from({ length: n }, (_, i) => text('x', 200, 10 * i, 3, [8, 'G'])),
          ],
        }),
        attach,
      ).warnings;
    expect(stray(1)).toContain(
      'Na hladině „G" (přidej k dílu) leží 1 segment mimo obrysy dílů – ignorován.',
    );
    expect(stray(1)).toContain('Na hladině „G" leží 1 text mimo obrysy dílů – nepřenesen.');
    expect(stray(2)).toContain(
      'Na hladině „G" (přidej k dílu) leží 2 segmenty mimo obrysy dílů – ignorovány.',
    );
    expect(stray(2)).toContain('Na hladině „G" leží 2 texty mimo obrysy dílů – nepřeneseny.');
    expect(stray(5)).toContain(
      'Na hladině „G" (přidej k dílu) leží 5 segmentů mimo obrysy dílů – ignorovány.',
    );
    expect(stray(5)).toContain('Na hladině „G" leží 5 textů mimo obrysy dílů – nepřeneseny.');

    // Jmenovitě se hlásí prvních 5 uzavřených mezer, zbytek souhrnem.
    const gaps = (n: number) =>
      partsFromDxf(
        'mezery.dxf',
        dxf({
          entities: Array.from({ length: n }, (_, i) => gappedSquare(30 * i, 0, 0.05)).flat(),
        }),
        multi,
      ).warnings.join('\n');
    expect(gaps(6)).toMatch(/Automaticky uzavřena další 1 mezera\./);
    expect(gaps(8)).toMatch(/Automaticky uzavřeny další 3 mezery\./);
    expect(gaps(12)).toMatch(/Automaticky uzavřeno dalších 7 mezer\./);
  });

  it('velké výkresy: otvory, díly s textem a přidaná geometrie se načtou včas', () => {
    const n = 6000;
    const side = Math.ceil(Math.sqrt(n));
    const at = (i: number, step: number) =>
      [(i % side) * step, Math.floor(i / side) * step] as const;
    const start = performance.now();

    const holes = [rectPoly(-10, -10, side * 10 + 20, side * 10 + 20)];
    for (let i = 0; i < n; i++) holes.push(circle(...at(i, 10), 3));
    const perforated = partsFromDxf('otvory.dxf', dxf({ entities: holes }), multi);
    expect(perforated.errors).toEqual([]);
    expect(perforated.parts).toHaveLength(1);
    expect(perforated.parts[0]!.shape!.holes).toHaveLength(n);

    const tagged: G[][] = [];
    for (let i = 0; i < n; i++) {
      const [x, y] = at(i, 30);
      tagged.push(
        rectPoly(x, y, 20, 20),
        line(x + 2, y + 2, x + 18, y + 18, [8, 'G']),
        arc(x + 10, y + 10, 3, 0, 180, [8, 'G']),
        text('pozn', x + 2, y + 5, 3, [8, 'G']),
        text(`D${i % 3}`, x + 2, y + 12, 4),
      );
    }
    const r = partsFromDxf('dily.dxf', dxf({ entities: tagged }), {
      ...multi,
      layerRoles: new Map([['G', 'attach' as const]]),
    });
    expect(r.errors).toEqual([]);
    expect(r.parts.map((p) => p.name).sort()).toEqual(['D0', 'D1', 'D2']);
    expect(r.parts.reduce((s, p) => s + p.quantity, 0)).toBe(n);
    for (const p of r.parts) {
      expect(p.shape!.marks).toHaveLength(1);
      expect(p.shape!.marks![0]!.segments).toHaveLength(2);
      expect(p.shape!.notes!.map((t) => t.text)).toContain('pozn');
    }
    // Před zavedením indexu obalových obdélníků desítky sekund.
    expect(performance.now() - start).toBeLessThan(15_000);
  }, 60_000);
});
