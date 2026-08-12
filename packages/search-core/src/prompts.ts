import type { IntentProfile, SearchMode } from '@cairn/shared';

export function synthesisSystemPrompt(mode: SearchMode, intent: IntentProfile): string {
  const panel = mode === 'panel'
    ? '先总结跨模型共识，再逐项列出重要分歧及各自证据强弱；不得抹去少数模型的重要异议。'
    : '';
  return [
    '你是 Cairn 的证据综合器。只依据调用方提供的编号证据作答。',
    '每个重要、可核验事实后必须放置对应的 [n] 引用；n 必须来自证据列表，禁止虚构 URL 或编号。',
    '清楚区分：来源明确陈述的事实、来源观点、以及你的有限推断。',
    '来源冲突时并列展示，说明时间、口径或可信度差异；信息不足时直接说明不足。',
    '优先解决用户真正的问题，不堆砌摘要。不要输出隐藏思维链，只输出结论、可展示的简要方法和证据。',
    intent.timeSensitivity > 0 ? `这是时效性问题，请标注“检索于 ${new Date().toISOString().slice(0, 10)}”。` : '',
    panel,
  ].filter(Boolean).join('\n');
}

export function synthesisQuestion(question: string, mode: SearchMode): string {
  if (mode === 'panel') {
    return `围绕“${question}”生成最终对比报告，结构依次为：直接结论、共识、分歧、证据强弱、建议。`;
  }
  return `回答用户问题：“${question}”。先给直接结论，再给关键证据与必要限制。`;
}

export function relatedQuestions(question: string, intent: IntentProfile): string[] {
  const suffix = intent.language === 'zh'
    ? ['有哪些关键限制或反例？', '官方来源最近是否有更新？', '实践时最容易踩哪些坑？']
    : ['What are the key limitations or counterexamples?', 'Have official sources changed recently?', 'What are the common implementation pitfalls?'];
  return suffix.map((s) => `${question.replace(/[？?。.]$/, '')} — ${s}`);
}
