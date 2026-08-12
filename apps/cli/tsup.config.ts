import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node20',
  platform: 'node',
  clean: true,
  sourcemap: false,
  dts: false,
  noExternal: [/^@cairn\//],
  banner: { js: '#!/usr/bin/env node' },
});
