import * as Comlink from 'comlink';
import type { NestingInput } from '../core/model.ts';
import type { NestOutcome, NestProgress } from '../core/nesting/nest.ts';
import type { DxfPartsResult } from '../core/import/dxf-parts.ts';
import type { DxfImportOptions, NestingService } from './service.ts';

/** Klient pro UI: výpočet vždy ve Web Workeru, nikdy v UI vlákně. */
export interface NestingClient {
  nest(input: NestingInput, onProgress?: (p: NestProgress) => void): Promise<NestOutcome>;
  /** Zastaví výpočet; `nest` se vrátí s nejlepším dosavadním výsledkem. */
  stop(): Promise<void>;
  /** Díly z DXF – čtení probíhá ve workeru. */
  importDxf(fileName: string, data: ArrayBuffer, opts: DxfImportOptions): Promise<DxfPartsResult>;
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

  const start = () => {
    worker = new Worker(new URL('./nesting.worker.ts', import.meta.url), { type: 'module' });
    remote = Comlink.wrap<NestingService>(worker);
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
    importDxf(fileName, data, opts) {
      return remote.importDxf(fileName, data, opts);
    },
    abort() {
      worker.terminate();
      rejectRunning?.(new NestingAbortedError());
      rejectRunning = null;
      start();
    },
    dispose() {
      worker.terminate();
      rejectRunning?.(new NestingAbortedError());
      rejectRunning = null;
    },
  };
}
