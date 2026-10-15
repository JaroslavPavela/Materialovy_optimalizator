/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: process.env.GITHUB_PAGES ? '/Materialovy_optimalizator/' : '/',
  plugins: [react()],
  worker: {
    format: 'es',
    // acad-ts (čtení DWG) hledá mapování entit podle názvu třídy
    // (`constructor.name`) – minifikace by názvy přejmenovala.
    rolldownOptions: { output: { keepNames: true } },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    // Benchmark se spouští zvlášť (`npm run bench`) – trvá desítky sekund.
    exclude: process.argv.some((a) => a.includes('tests/bench')) ? [] : ['tests/bench/**'],
    environment: 'node',
  },
});
