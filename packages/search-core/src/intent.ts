import { guessLanguage, type IntentProfile, type SearchMode } from '@cairn/shared';

/**
 * 低延迟、确定性的意图预判。它不伪装成隐藏思维链，只输出产品可展示的结构化标签。
 * 后续可把结果作为提示交给 planner 模型细化，但核心流程不依赖额外付费调用。
 */
export function classifyIntent(question: string, mode: SearchMode): IntentProfile {
  const q = question.toLowerCase();
  const language = guessLanguage(question);
  const latest = /(最新|近期|今天|本周|本月|现在|当前|recent|latest|today|current|news|release|202[4-9])/i.test(q);
  const compare = /(对比|比较|区别|vs\.?|versus|trade-?offs?|优缺点|哪个更好)/i.test(q);
  const troubleshoot = /(报错|错误|异常|失败|无法|issue|bug|error|exception|fails?|fix|解决)/i.test(q);
  const howto = /(如何|怎么|教程|步骤|配置|部署|how to|guide|setup|configure|implement)/i.test(q);
  const opinion = /(争议|正反|观点|利弊|支持|反对|controvers|pros and cons|argument)/i.test(q);
  const news = /(新闻|消息|动态|发布|收购|融资|news|announcement|launched|released)/i.test(q) && latest;

  let kind: IntentProfile['kind'] = 'factual';
  if (compare) kind = 'comparison';
  else if (troubleshoot) kind = 'troubleshooting';
  else if (opinion) kind = 'opinion';
  else if (news) kind = 'news';
  else if (howto) kind = 'howto';
  else if (mode === 'dive' || question.length > 180) kind = 'research';

  const domains = inferDomains(q);
  const socialRelevant = latest && (news || opinion || /(舆情|社区|讨论|x平台|twitter|social|sentiment)/i.test(q));
  const depth: 1 | 2 | 3 = mode === 'flash' ? 1 : mode === 'dive' ? 3 : 2;

  return {
    kind,
    timeSensitivity: latest ? 2 : kind === 'news' ? 2 : 0,
    language,
    domains,
    depth,
    socialRelevant,
  };
}

function inferDomains(q: string): string[] {
  const matches: Array<[RegExp, string]> = [
    [/(api|sdk|代码|编程|软件|javascript|typescript|python|rust|github|数据库|框架)/i, 'software'],
    [/(ai|人工智能|模型|llm|grok|claude|openai|anthropic)/i, 'ai'],
    [/(商业|公司|市场|融资|营收|business|market|revenue|startup)/i, 'business'],
    [/(论文|研究|science|paper|clinical|学术|实验)/i, 'research'],
    [/(安全|漏洞|攻击|security|vulnerability|cve)/i, 'security'],
    [/(政策|政府|法律|法规|government|policy|law)/i, 'policy'],
  ];
  const domains = matches.filter(([re]) => re.test(q)).map(([, label]) => label);
  return domains.length ? domains : ['general'];
}
