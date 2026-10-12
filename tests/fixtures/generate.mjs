// Jednorázový generátor testovacích vzorků: `node tests/fixtures/generate.mjs`.
// Existující soubory nepřepisuje (vzorky se po vytvoření nesmí měnit).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));

function write(rel, bytes) {
  const file = path.join(root, rel);
  if (fs.existsSync(file)) {
    console.log(`přeskočeno (existuje): ${rel}`);
    return;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, bytes);
  console.log(`vytvořeno: ${rel}`);
}

const utf8 = (text) => Buffer.from(text, 'utf8');
const utf8bom = (text) => Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), utf8(text)]);
const utf16le = (text) => Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]);

/** Kódování Windows-1250 podle tabulky odvozené z TextDecoderu (Node nemá enkodér). */
const cp1250 = (() => {
  const decoder = new TextDecoder('windows-1250');
  const map = new Map();
  for (let b = 0; b < 256; b++) map.set(decoder.decode(Uint8Array.of(b)), b);
  return (text) =>
    Buffer.from(
      [...text].map((ch) => {
        const b = map.get(ch);
        if (b === undefined) throw new Error(`Znak „${ch}" nejde zapsat ve Windows-1250.`);
        return b;
      }),
    );
})();

const lines = (rows, eol = '\r\n') => rows.join(eol) + eol;

// Český Excel: středník, desetinná čárka, Windows-1250, CRLF, jednotky v hlavičce.
write(
  'csv/excel-cz-strednik-1250.csv',
  cp1250(
    lines([
      'Název;Šířka (mm);Výška (mm);Počet;Materiál;Tloušťka;Rotace',
      'Bok skříně;720;560;4;DTD dub;18;180',
      'Police;764,5;520;6;DTD dub;18;90',
      'Záda;1 200;800;1;HDF;3;volné',
      'Dvířka;715,5;396,8;2;DTD dub;18;žádná',
    ]),
  ),
);

// UTF-8 s BOM (Excel „CSV UTF-8"), středník, desetinná čárka.
write(
  'csv/utf8-bom.csv',
  utf8bom(
    lines([
      'název;šířka;výška;počet;materiál;tloušťka;rotace',
      'Čelo zásuvky;596;140;3;MDF lak;19;',
      'Dno zásuvky;550,5;480;3;HDF;3;90',
      'Ďáblík – ozdoba;120,25;80;10;Překližka;6;volne',
    ]),
  ),
);

// Oddělovač čárka, desetinná tečka, název s čárkou v uvozovkách, LF.
write(
  'csv/carka-tecka.csv',
  utf8(
    lines(
      [
        'nazev,sirka,vyska,pocet,material',
        '"Police, horní",764.5,300,2,DTD',
        'Bok,720,560,4,DTD',
        '"Krycí lišta ""A""",1200.75,50.5,8,',
      ],
      '\n',
    ),
  ),
);

// Tabulátor jako oddělovač.
write(
  'csv/tabulator.tsv',
  utf8(
    lines([
      'Název\tŠířka\tVýška\tPočet',
      'Deska A\t1000\t500\t2',
      'Deska B\t250,5\t125\t12',
    ]),
  ),
);

// Bez hlavičky – pořadí název; šířka; výška; počet; materiál.
write(
  'csv/bez-hlavicky.csv',
  utf8(
    lines([
      'Díl 1;400;300;5;Plech DC01',
      'Díl 2;250,5;125;2;Plech DC01',
      '',
      'Díl 3;100;100;20;',
    ]),
  ),
);

// Chybné řádky + prázdné řádky (čísla řádků musí sedět s Excelem).
write(
  'csv/chyby.csv',
  utf8(
    lines([
      'název;šířka;výška;počet;rotace',
      'Dobrý díl;500;400;2;90',
      'Písmeno v šířce;12,a;400;1;',
      '',
      'Záporná výška;500;-5;1;',
      'Chybí počet;500;400;;',
      ';300;200;1;',
      'Desetinný počet;300;200;1,5;',
      'Nulová šířka;0;200;1;',
      ';;;;',
      'Špatná rotace;300;200;1;45',
      'Velký počet;10;10;20000;',
      'Poslední dobrý;300;200;3;zadna',
    ]),
  ),
);

// Anglická hlavička, jiné pořadí sloupců.
write(
  'csv/anglicka-hlavicka.csv',
  utf8(
    lines([
      'Quantity,Name,Width,Height,Thickness,Material,Rotation',
      '2,Side panel,720,560,18,Oak,flip',
      '6,Shelf,764.5,520,18,Oak,ortho',
      '1,Back,1200,800,3,HDF,free',
    ]),
  ),
);

// Excel „Text v kódování Unicode": UTF-16LE s BOM, tabulátor.
write(
  'csv/excel-unicode-utf16.txt',
  utf16le(
    lines([
      'Název\tŠířka\tVýška\tPočet',
      'Žebro\t320,5\t95\t14',
      'Úchyt\t40\t40\t28',
    ]),
  ),
);

// Víceřádkový název v uvozovkách – další řádky musí mít správné číslo.
write(
  'csv/viceradkovy-nazev.csv',
  utf8(
    lines(
      ['název;šířka;výška;počet', '"Deska\ns poznámkou";500;400;1', 'Chybná;x;400;1'],
      '\n',
    ),
  ),
);

// Hlavička bez povinných sloupců.
write('csv/chybi-sloupec.csv', utf8(lines(['název;šířka;počet', 'Deska;500;2'])));

// Velký soubor: 1000 dílů, deterministický obsah.
{
  const rows = ['název;šířka;výška;počet;materiál;tloušťka;rotace'];
  const rotations = ['90', '180', 'volne', 'zadna', ''];
  let seed = 12345;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  for (let i = 1; i <= 1000; i++) {
    const w = (50 + Math.floor(rnd() * 19500) / 10).toFixed(1).replace('.', ',');
    const h = (50 + Math.floor(rnd() * 9500) / 10).toFixed(1).replace('.', ',');
    const q = 1 + Math.floor(rnd() * 20);
    rows.push(`Díl ${i};${w};${h};${q};DTD;18;${rotations[i % rotations.length]}`);
  }
  write('csv/velky-1000-dilu.csv', utf8(lines(rows)));
}
