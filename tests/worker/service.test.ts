import * as Comlink from 'comlink';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_NESTING_PARAMS, type NestingInput } from '../../src/core/model.ts';
import { nest, type NestProgress } from '../../src/core/nesting/nest.ts';
import { createNestingService, type NestingService } from '../../src/worker/service.ts';

const input: NestingInput = {
  parts: [{ id: 'a', name: 'A', width: 300, height: 200, quantity: 20, rotation: 'ortho' }],
  sheets: [
    { id: 's', name: 'S', width: 1200, height: 800, stock: null, margin: 0, forbiddenZones: [] },
  ],
  params: DEFAULT_NESTING_PARAMS,
};

describe('NestingService', () => {
  it('výsledek odpovídá synchronnímu nest()', async () => {
    const service = createNestingService();
    expect(await service.nest(input)).toEqual(nest(input));
  });

  it('průběh nejvýš ~4× za sekundu: první a poslední krok vždy, mezi nimi podle času', async () => {
    let t = 0;
    const service = createNestingService(
      async () => {},
      () => (t += 100),
    );
    const steps: number[] = [];
    await service.nest(input, (p) => steps.push(p.step));
    expect(steps[0]).toBe(1);
    expect(steps[steps.length - 1]).toBe(16);
    // čas roste o 100 ms na každé volání now() → hlášení zhruba každý třetí krok
    expect(steps.length).toBeLessThan(16);
    expect(steps.length).toBeGreaterThan(2);
  });

  it('stop() ukončí výpočet s nejlepším dosavadním výsledkem', async () => {
    let service: NestingService | null = null;
    let yields = 0;
    service = createNestingService(async () => {
      yields += 1;
      if (yields === 3) service!.stop();
    });
    const outcome = await service.nest(input);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.stopped).toBe(true);
    expect(outcome.result.metrics.placedCount).toBe(20);
    expect(yields).toBe(3);
  });

  it('stop() bez běžícího výpočtu neovlivní další výpočet', async () => {
    const service = createNestingService(async () => {});
    service.stop();
    const outcome = await service.nest(input);
    expect(outcome.ok && outcome.stopped).toBe(false);
  });

  it('nový výpočet zastaví předchozí', async () => {
    const service = createNestingService();
    const first = service.nest(input);
    const second = service.nest(input);
    const [a, b] = await Promise.all([first, second]);
    expect(a.ok && a.stopped).toBe(true);
    expect(b.ok && b.stopped).toBe(false);
  });
});

describe('přes Comlink (MessageChannel jako ve workeru)', () => {
  let channel: MessageChannel | null = null;
  afterEach(() => {
    channel?.port1.close();
    channel?.port2.close();
  });

  it('výpočet, průběh přes proxy a zastavení', async () => {
    channel = new MessageChannel();
    Comlink.expose(createNestingService(), channel.port1);
    const remote = Comlink.wrap<NestingService>(channel.port2);

    const progress: NestProgress[] = [];
    const outcome = await remote.nest(
      input,
      Comlink.proxy((p: NestProgress) => {
        progress.push(p);
      }),
    );
    expect(outcome).toEqual(nest(input));
    expect(progress.length).toBeGreaterThan(0);
    expect(progress[progress.length - 1]!.step).toBe(16);

    const running = remote.nest(input);
    await remote.stop();
    const stopped = await running;
    expect(stopped.ok && stopped.stopped).toBe(true);
    remote[Comlink.releaseProxy]();
  });
});
