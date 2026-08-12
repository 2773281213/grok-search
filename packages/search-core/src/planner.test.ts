import { describe, expect, it } from 'vitest';
import { classifyIntent } from './intent.js';
import { planQueries } from './planner.js';

describe('classifyIntent', () => {
  it('识别时效性技术比较', () => {
    const intent = classifyIntent('比较 OpenAI 和 Anthropic 最新 API 的优缺点', 'dive');
    expect(intent.kind).toBe('comparison');
    expect(intent.timeSensitivity).toBe(2);
    expect(intent.domains).toContain('ai');
    expect(intent.depth).toBe(3);
  });

  it('识别故障排查', () => {
    expect(classifyIntent('Next.js build error 怎么解决', 'flash').kind).toBe('troubleshooting');
  });
});

describe('planQueries', () => {
  it('深度研究生成角色不同的 4-8 条子查询', () => {
    const intent = classifyIntent('调查近期 AI API 变化及风险', 'dive');
    const plan = planQueries('调查近期 AI API 变化及风险', 'dive', intent, ['xai', 'openai', 'anthropic']);
    expect(plan.length).toBeGreaterThanOrEqual(4);
    expect(plan.length).toBeLessThanOrEqual(8);
    const roles = plan.map((q) => q.role);
    expect(roles).toContain('core');
    expect(roles).toContain('official');
    expect(roles).toContain('counter');
    expect(new Set(roles).size).toBe(roles.length);
  });

  it('社交查询优先指派 xAI', () => {
    const intent = classifyIntent('最近大家在 X 上如何评价这个发布？', 'pulse');
    const plan = planQueries('最近大家在 X 上如何评价这个发布？', 'pulse', intent, ['openai', 'xai']);
    expect(plan.find((q) => q.role === 'social')?.providerId).toBe('xai');
  });

  it('panel 为每个 Provider 创建独立研究任务', () => {
    const intent = classifyIntent('比较两种方案', 'panel');
    const plan = planQueries('比较两种方案', 'panel', intent, ['xai', 'openai', 'anthropic']);
    expect(plan.map((q) => q.providerId)).toEqual(['xai', 'openai', 'anthropic']);
  });
});
