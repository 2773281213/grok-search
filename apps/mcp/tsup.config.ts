import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node20',
  platform: 'node',
  clean: true,
  sourcemap: false,
  dts: false,
  // 工作区包以 TS 源码形式导出，必须打进产物；原生模块保持外置
  noExternal: [/^@cairn\//],
  banner: { js: '#!/usr/bin/env node' },
});
