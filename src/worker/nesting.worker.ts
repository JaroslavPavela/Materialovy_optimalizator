// Web Worker výpočtu nestingu – vystaví NestingService přes Comlink.
import * as Comlink from 'comlink';
import { createNestingService } from './service.ts';

Comlink.expose(createNestingService());
