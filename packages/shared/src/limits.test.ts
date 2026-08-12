import { describe, expect, it } from 'vitest';
import { backoffRetry, createLimiter, sleep, TimeoutError, withTimeout } from './limits.js';

describe('createLimiter', () => {
  it('并发不超过上限', async () => {
    const limit = createLimiter(2);
    let active = 0;
    let peak = 0;
    const jobs = Array.from({ length: 8 }, () =>
      limit(async () => {
        active++;
        peak = Math.max(peak, active);
        await sleep(20);
        active--;
      }),
    );
    await Promise.all(jobs);
    expect(peak).toBeLessThanOrEqual(2);
  });

  it('任务抛错不阻塞后续任务', async () => {
    const limit = createLimiter(1);
    await expect(limit(async () => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    await expect(limit(async () => 'ok')).resolves.toBe('ok');
  });
});

describe('withTimeout', () => {
  it('超时抛 TimeoutError 并中断信号', async () => {
    let aborted = false;
    await expect(
      withTimeout(async (signal) => {
        signal.addEventListener('abort', () => (aborted = true));
        await sleep(500, signal);
      }, 40),
    ).rejects.toBeInstanceOf(TimeoutError);
    expect(aborted).toBe(true);
  });

  it('父信号取消向下传递', async () => {
    const parent = new AbortController();
    const p = withTimeout(async (signal) => sleep(1000, signal), 5000, parent.signal);
    parent.abort(new Error('用户取消'));
    await expect(p).rejects.toThrow('用户取消');
  });

  it('按时完成返回结果', async () => {
    await expect(withTimeout(async () => 42, 1000)).resolves.toBe(42);
  });
});

describe('backoffRetry', () => {
  it('重试直至成功', async () => {
    let n = 0;
    const result = await backoffRetry(
      async () => {
        n++;
        if (n < 3) throw new Error('flaky');
        return 'done';
      },
      { retries: 5, baseDelayMs: 5 },
    );
    expect(result).toBe('done');
    expect(n).toBe(3);
  });

  it('shouldRetry 返回 false 时立刻放弃', async () => {
    let n = 0;
    await expect(
      backoffRetry(
        async () => {
          n++;
          throw new Error('fatal');
        },
        { retries: 5, baseDelayMs: 5, shouldRetry: () => false },
      ),
    ).rejects.toThrow('fatal');
    expect(n).toBe(1);
  });

  it('超过次数后抛最后一个错误', async () => {
    await expect(
      backoffRetry(async () => Promise.reject(new Error('always')), { retries: 2, baseDelayMs: 5 }),
    ).rejects.toThrow('always');
  });
});
