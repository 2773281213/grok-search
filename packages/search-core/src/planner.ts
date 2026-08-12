import {
  MODE_PROFILES,
  idOf,
  type IntentProfile,
  type PlannedQuery,
  type ProviderId,
  type QueryRole,
  type SearchMode,
} from '@cairn/shared';

/** 生成角色不同而非同义改写的查询计划。 */
export function planQueries(
  question: string,
  mode: SearchMode,
  intent: IntentProfile,
  providers: ProviderId[],
): PlannedQuery[] {
  if (!providers.length) throw new Error('没有可用 Provider');
  if (mode === 'panel') {
    return providers.slice(0, 3).map((providerId) => query('core', question, providerId, intent.language));
  }

  const desired = mode === 'flash' ? 2 : mode === 'pulse' ? 3 : 6;
  const roles: QueryRole[] = selectRoles(intent, mode).slice(0, desired);
  const [min, max] = MODE_PROFILES[mode].queryRange;
  while (roles.length < min) roles.push(roles.length ? 'official' : 'core');

  const unique = [...new Set(roles)].slice(0, max);
  return unique.map((role, index) => {
    const providerId = chooseProvider(role, providers, index);
    return query(role, queryText(role, question), providerId, role === 'altlang' ? alternateLanguage(intent.language) : intent.language);
  });
}

function selectRoles(intent: IntentProfile, mode: SearchMode): QueryRole[] {
  const roles: QueryRole[] = ['core', 'official'];
  if (intent.timeSensitivity > 0) roles.push('latest');
  if (intent.kind === 'comparison' || intent.kind === 'opinion' || mode === 'dive') roles.push('counter');
  if (intent.language !== 'en' && mode === 'dive') roles.push('altlang');
  if ((intent.socialRelevant || mode === 'pulse') && !roles.includes('social')) roles.push('social');
  if (mode === 'dive' && !roles.includes('latest')) roles.push('latest');
  return roles;
}

function queryText(role: QueryRole, question: string): string {
  switch (role) {
    case 'core': return question;
    case 'official': return `${question}\n优先查找官方文档、原始公告、项目仓库、论文或第一手数据。`;
    case 'latest': return `${question}\n聚焦最近进展，核对发布日期与当前有效性。`;
    case 'counter': return `${question}\n寻找反方证据、失败案例、限制、风险与利益冲突。`;
    case 'altlang': return `Find high-quality English primary sources for this question: ${question}`;
    case 'social': return `${question}\n检索 X 上近期一手讨论；将未经证实的观点与事实分开。`;
  }
}

function chooseProvider(role: QueryRole, providers: ProviderId[], index: number): ProviderId {
  if (role === 'social' && providers.includes('xai')) return 'xai';
  return providers[index % providers.length]!;
}

function query(role: QueryRole, text: string, providerId: ProviderId, language?: string): PlannedQuery {
  return { id: idOf.query(), role, text, providerId, language };
}

function alternateLanguage(language: string): string {
  return language === 'en' ? 'zh' : 'en';
}
