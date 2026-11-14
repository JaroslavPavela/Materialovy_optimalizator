import * as Comlink from 'comlink';
import type { NestingInput } from '../core/model.ts';
import type { NestOutcome, NestProgress } from '../core/nesting/nest.ts';
import type { DxfPartsResult } from '../core/import/dxf-parts.ts';
import type { ExportFile } from '../core/export/files.ts';
import type { DxfExportRequest, DxfImportOptions, NestingService } from './service.ts';

/** Klient pro UI: výpočet vždy ve Web Workeru, nikdy v UI vlákně. */
export interface NestingClient {
  nest(input: NestingInput, onProgress?: (p: NestProgress) => void): Promise<NestOutcome>;
  /** Zastaví výpočet; `nest` se vrátí s nejlepším dosavadním výsledkem. */
  stop(): Promise<void>;
  /** Díly z DXF nebo DWG – čtení probíhá ve workeru. */
  importDrawing(
    fileName: string,
    data: ArrayBuffer,
    opts: DxfImportOptions,
  ): Promise<DxfPartsResult>;
  /** DXF 2000/2018 – zápis probíhá ve workeru. */
  writeDxf(request: DxfExportRequest): Promise<ExportFile[]>;
  /** Okamžitě ukončí worker (běžící `nest` skončí chybou) a připraví nový. */
  abort(): void;
  /** Ukončí worker natrvalo. */
  dispose(): void;
}

export class NestingAbortedError extends Error {
  constructor() {
    super('Výpočet byl zrušen.');
    this.name = 'NestingAbortedError';
  }
}

export function createNestingClient(): NestingClient {
  let worker: Worker;
  let remote: Comlink.Remote<NestingService>;
  let rejectRunning: ((e: Error) => void) | null = null;
  /** Čekající import a export – po ukončení workeru se jinak nikdy nevyřeší. */
  const pending = new Set<(e: Error) => void>();
  const tracked = <T>(call: () => Promise<T>) =>
    new Promise<T>((resolve, reject) => {
      pending.add(reject);
      call()
        .then(resolve, reject)
        .finally(() => pending.delete(reject));
    });
  /** Odmítne běžící výpočet i čekající import a export. */
  const rejectAll = (error: () => Error) => {
    rejectRunning?.(error());
    rejectRunning = null;
    for (const reject of pending) reject(error());
    pending.clear();
  };

  const start = () => {
    const w = new Worker(new URL('./nesting.worker.ts', import.meta.url), { type: 'module' });
    // Pád workeru (nenačtený skript, nedostatek paměti, nepřenositelná zpráva)
    // by jinak nechal volání čekat navždy: odmítnout je a založit nový worker.
    const crashed = (e: Event) => {
      if (w !== worker) return;
      const detail = e instanceof ErrorEvent && e.message ? ` (${e.message})` : '';
      w.terminate();
      rejectAll(() => new Error(`Výpočetní vlákno selhalo${detail}. Zkuste akci zopakovat.`));
      start();
    };
    w.addEventListener('error', crashed);
    w.addEventListener('messageerror', crashed);
    worker = w;
    remote = Comlink.wrap<NestingService>(w);
  };
  start();

  return {
    nest(input, onProgress) {
      return new Promise<NestOutcome>((resolve, reject) => {
        rejectRunning = reject;
        remote
          .nest(input, onProgress ? Comlink.proxy(onProgress) : undefined)
          .then(resolve, reject)
          .finally(() => {
            if (rejectRunning === reject) rejectRunning = null;
          });
      });
    },
    stop() {
      return remote.stop();
    },
    importDrawing(fileName, data, opts) {
      return tracked(() => remote.importDrawing(fileName, data, opts));
    },
    writeDxf(request) {
      return tracked(() => remote.writeDxf(request));
    },
    abort() {
      worker.terminate();
      rejectAll(() => new NestingAbortedError());
      start();
    },
    dispose() {
      worker.terminate();
      rejectAll(() => new NestingAbortedError());
    },
  };
}
