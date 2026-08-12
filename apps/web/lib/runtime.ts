import { createNodeSearchRuntime, type NodeSearchRuntime } from '@cairn/search-core';

export type CairnRuntime = NodeSearchRuntime;

declare global {
  var __cairnRuntime: CairnRuntime | undefined;
}

export function getRuntime(): CairnRuntime {
  if (!globalThis.__cairnRuntime) globalThis.__cairnRuntime = createNodeSearchRuntime();
  return globalThis.__cairnRuntime;
}

/** Provider 设置更新后重建注册表；先优雅取消旧运行时中的活跃任务。 */
export async function resetRuntime(): Promise<void> {
  const current = globalThis.__cairnRuntime;
  if (!current) return;
  await current.close();
  globalThis.__cairnRuntime = undefined;
}
