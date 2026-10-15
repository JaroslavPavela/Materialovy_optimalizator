// Jednorázový generátor vzorků DWG: `node tests/fixtures/generate-dwg.ts`.
// Existující soubory nepřepisuje (vzorky se po vytvoření nesmí měnit).
// Vzorky DXF z tests/fixtures/dxf zapíše přes acad-ts jako DWG v různých
// verzích; test (tests/core/import/dwg.test.ts) ověří, že import DWG dá
// stejné díly jako import původního DXF.
// Skutečný výkres z AutoCADu je autocad-vzorek-ac1018.dwg – sample_AC1018.dwg
// z repozitáře ACadSharp (MIT, https://github.com/DomCR/ACadSharp/tree/master/samples).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import DxfParser from 'dxf-parser';
import {
  ACadVersion,
  BlockRecord,
  CadDocument,
  DwgWriter,
  DxfReader,
  Insert,
  LwPolyline,
  LwPolylineVertex,
  Polyline2D,
  XY,
  type Entity,
} from '@node-projects/acad-ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, 'dwg');

/** Vzorek DXF → verze DWG, ve které se zapíše (každá verze aspoň jednou). */
export const DWG_FROM_DXF: Readonly<Record<string, keyof typeof ACadVersion>> = {
  'zrcadleny-rozvin.dxf': 'AC1014',
  'plan-polyline.dxf': 'AC1015',
  'palce.dxf': 'AC1018',
  'spline.dxf': 'AC1021',
  'blok.dxf': 'AC1024',
  'vice-dilu.dxf': 'AC1027',
  'dil-s-otvory.dxf': 'AC1032',
};

export const dwgName = (dxf: string, version: string) =>
  dxf.replace(/\.dxf$/, `-${version.toLowerCase()}.dwg`);

/**
 * POLYLINE 2D jako LWPOLYLINE – AutoCAD 2000+ ukládá 2D polyline takto;
 * acad-ts navíc vrcholy POLYLINE do DWG nezapíše (klonované nemají handle)
 * a u DXF R12 ztratí příznak uzavření (70 = 1) – ten se bere z dxf-parseru.
 */
function toLwPolyline(p: Polyline2D, closed: boolean): LwPolyline {
  const lw = new LwPolyline(
    [...p.vertices].map((v) => {
      const vertex = v as unknown as { location: { x: number; y: number }; bulge: number };
      const out = new LwPolylineVertex(new XY(vertex.location.x, vertex.location.y));
      out.bulge = vertex.bulge;
      return out;
    }),
  );
  lw.isClosed = closed;
  lw.normal = p.normal;
  lw.elevation = p.elevation;
  return lw;
}

/** DXF → DWG: nový dokument s výchozími tabulkami, vrstvy, bloky a entity. */
function convert(dxfBytes: Uint8Array, version: keyof typeof ACadVersion): Uint8Array {
  const src = DxfReader.readFromStream(dxfBytes, () => {});
  const parsed = new DxfParser().parseSync(new TextDecoder().decode(dxfBytes));
  const closedFlags = (parsed?.entities ?? [])
    .filter((e) => e.type === 'POLYLINE')
    .map((e) => (e as { shape?: boolean }).shape === true);
  const doc = new CadDocument(ACadVersion[version], true);
  doc.header!.insUnits = src.header!.insUnits;
  for (const layer of src.layers!) {
    if (!doc.layers!.contains(layer.name)) doc.layers!.add(layer.clone() as typeof layer);
  }
  const copy = (e: Entity, blocks: Map<string, BlockRecord>): Entity => {
    const c =
      e instanceof Polyline2D ? toLwPolyline(e, closedFlags.shift()!) : (e.clone() as Entity);
    if (c instanceof Insert && e instanceof Insert) c.block = blocks.get(e.block!.name)!;
    c.layer = doc.layers!.get(e.layer.name) ?? c.layer;
    return c;
  };
  const blocks = new Map<string, BlockRecord>();
  for (const br of src.blockRecords!) {
    if (br.name.startsWith('*')) continue;
    const nb = new BlockRecord(br.name);
    for (const e of br.entities) nb.entities.add(copy(e, blocks));
    doc.blockRecords!.add(nb);
    blocks.set(br.name, nb);
  }
  for (const e of src.modelSpace!.entities) doc.modelSpace!.entities.add(copy(e, blocks));
  return DwgWriter.writeToBuffer(doc);
}

function write(name: string, data: Uint8Array) {
  const file = path.join(root, name);
  if (fs.existsSync(file)) {
    console.log(`přeskočeno (existuje): dwg/${name}`);
    return;
  }
  fs.writeFileSync(file, data);
  console.log(`vytvořeno: dwg/${name}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  fs.mkdirSync(root, { recursive: true });
  for (const [dxf, version] of Object.entries(DWG_FROM_DXF)) {
    const bytes = new Uint8Array(fs.readFileSync(path.join(here, 'dxf', dxf)));
    write(dwgName(dxf, version), convert(bytes, version));
  }
}
