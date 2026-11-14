import type { Rect } from './types.ts';

/** Obdélník zasahující do víc buněk se drží zvlášť a zkouší u každého dotazu. */
const MAX_CELLS = 64;
/** Nejvíc buněk mřížky v jednom směru. */
const MAX_SIDE = 1024;

/** Překrývají se (nebo dotýkají) obdélníky `a` a `b` zvětšený o `pad`? */
export function rectsTouch(a: Rect, b: Rect, pad = 0): boolean {
  return (
    a.x <= b.x + b.width + pad &&
    b.x - pad <= a.x + a.width &&
    a.y <= b.y + b.height + pad &&
    b.y - pad <= a.y + a.height
  );
}

/**
 * Mřížkový index obdélníků (obalových obdélníků kontur, dílů…) pro hledání
 * kandidátů bez procházení všech: dotaz vrátí právě ty obdélníky, které se
 * s dotazem překrývají nebo dotýkají. Buňka má zhruba plochu připadající na
 * jeden obdélník; velké obdélníky (tabule s tisíci otvorů) jsou mimo mřížku.
 */
export class RectIndex {
  private readonly rects: readonly Rect[];
  private readonly x0: number;
  private readonly y0: number;
  private readonly size: number;
  private readonly cols: number;
  private readonly rows: number;
  private readonly cells = new Map<number, number[]>();
  private readonly large: number[] = [];
  /** Indexy platných (konečných) obdélníků – jen ty dotaz vrací. */
  private readonly valid: number[] = [];
  /** Rozsah přetekl (souřadnice kolem 1e308): mřížka nejde, vždy úplný průchod. */
  private readonly linear: boolean;
  /** Značky „už nalezen v dotazu č." – bez mazání mezi dotazy. */
  private readonly seen: Uint32Array;
  private stamp = 0;

  constructor(rects: readonly Rect[]) {
    this.rects = rects;
    this.seen = new Uint32Array(rects.length);
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    const finite = rects.map(
      (r) =>
        Number.isFinite(r.x) &&
        Number.isFinite(r.y) &&
        Number.isFinite(r.width) &&
        Number.isFinite(r.height),
    );
    let count = 0;
    rects.forEach((r, i) => {
      if (!finite[i]) return;
      count++;
      minX = Math.min(minX, r.x);
      minY = Math.min(minY, r.y);
      maxX = Math.max(maxX, r.x + r.width);
      maxY = Math.max(maxY, r.y + r.height);
    });
    let w = count > 0 ? maxX - minX : 0;
    let h = count > 0 ? maxY - minY : 0;
    this.linear = !Number.isFinite(w) || !Number.isFinite(h) || !Number.isFinite(w * h);
    if (this.linear) w = h = 0;
    this.x0 = count > 0 ? minX : 0;
    this.y0 = count > 0 ? minY : 0;
    const side = Math.max(w, h);
    // Plocha na obdélník; u rozsahu nulové šířky nebo výšky délka na obdélník.
    const perRect = w > 0 && h > 0 ? Math.sqrt((w * h) / count) : side / Math.max(1, count);
    this.size = Math.max(perRect, side / MAX_SIDE) || 1;
    this.cols = Math.max(1, Math.min(MAX_SIDE, Math.ceil(w / this.size)));
    this.rows = Math.max(1, Math.min(MAX_SIDE, Math.ceil(h / this.size)));
    rects.forEach((r, i) => {
      // Neplatný obdélník se s ničím nepřekrývá – do indexu nepatří.
      if (!finite[i]) return;
      this.valid.push(i);
      if (this.linear) return;
      const c0 = this.col(r.x);
      const c1 = this.col(r.x + r.width);
      const r0 = this.row(r.y);
      const r1 = this.row(r.y + r.height);
      if ((c1 - c0 + 1) * (r1 - r0 + 1) > MAX_CELLS) {
        this.large.push(i);
        return;
      }
      for (let y = r0; y <= r1; y++) {
        for (let x = c0; x <= c1; x++) {
          const key = y * this.cols + x;
          const cell = this.cells.get(key);
          if (cell) cell.push(i);
          else this.cells.set(key, [i]);
        }
      }
    });
  }

  private col(x: number): number {
    return Math.min(this.cols - 1, Math.max(0, Math.floor((x - this.x0) / this.size)));
  }

  private row(y: number): number {
    return Math.min(this.rows - 1, Math.max(0, Math.floor((y - this.y0) / this.size)));
  }

  /**
   * Indexy obdélníků, které se s `q` zvětšeným o `pad` překrývají nebo
   * dotýkají, vzestupně.
   */
  query(q: Rect, pad = 0): number[] {
    const out: number[] = [];
    const lo = { x: q.x - pad, y: q.y - pad };
    const hi = { x: q.x + q.width + pad, y: q.y + q.height + pad };
    if (!(lo.x <= hi.x && lo.y <= hi.y)) return out;
    const c0 = this.col(lo.x);
    const c1 = this.col(hi.x);
    const r0 = this.row(lo.y);
    const r1 = this.row(hi.y);
    if (this.linear || (c1 - c0 + 1) * (r1 - r0 + 1) >= this.valid.length) {
      // Dotaz přes velkou část mřížky: projít všechny obdélníky je levnější.
      for (const i of this.valid) {
        if (rectsTouch(this.rects[i]!, q, pad)) out.push(i);
      }
      return out;
    }
    if (++this.stamp === 0xffffffff) {
      this.seen.fill(0);
      this.stamp = 1;
    }
    const take = (i: number) => {
      if (this.seen[i] === this.stamp) return;
      this.seen[i] = this.stamp;
      if (rectsTouch(this.rects[i]!, q, pad)) out.push(i);
    };
    this.large.forEach(take);
    for (let y = r0; y <= r1; y++) {
      for (let x = c0; x <= c1; x++) this.cells.get(y * this.cols + x)?.forEach(take);
    }
    return out.sort((a, b) => a - b);
  }
}
