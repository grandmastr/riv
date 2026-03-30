import OpenAI from 'openai';
import { z } from 'zod';
import type { ContextAttachment, ConversationMessage } from '@riv/contracts';

import type {
  ActionProposalDraft,
  ModelGateway,
  ModelGatewayStreamEvent,
  ModelGatewayTurnInput,
  ModelGatewayTurnResult
} from './types';

export type MockModelGatewayResponse =
  | ModelGatewayTurnResult
  | ((
      input: ModelGatewayTurnInput
    ) => Promise<ModelGatewayTurnResult> | ModelGatewayTurnResult);

export type OpenAIModelGatewayOptions = {
  apiKey: string;
  model?: string;
  defaultProposals?: ActionProposalDraft[];
};

const actionProposalDraftSchema = z.object({
  kind: z.enum(['groupTabs', 'moveTabs', 'closeTabs', 'focusTab']),
  reason: z.string().min(1),
  preview: z.object({
    title: z.string().min(1),
    summary: z.string().min(1),
    items: z.array(z.string())
  }),
  riskLevel: z.enum(['low', 'medium', 'high']),
  payload: z.record(z.string(), z.unknown())
});

const actionProposalDraftWithoutPayloadSchema = z.object({
  kind: z.enum(['groupTabs', 'moveTabs', 'closeTabs', 'focusTab']),
  reason: z.string().min(1),
  preview: z.object({
    title: z.string().min(1),
    summary: z.string().min(1),
    items: z.array(z.string())
  }),
  riskLevel: z.enum(['low', 'medium', 'high'])
});

const actionProposalTool = {
  type: 'function' as const,
  name: 'create_action_proposal',
  description:
    'Create one browser action proposal for supported tab-management actions when the user asks to organize, group, move, focus, or close tabs and the provided tab context is sufficient.',
  strict: false,
  parameters: {
    type: 'object',
    additionalProperties: false,
    required: ['kind', 'reason', 'preview', 'riskLevel', 'payload'],
    properties: {
      kind: {
        type: 'string',
        enum: ['groupTabs', 'moveTabs', 'closeTabs', 'focusTab']
      },
      reason: {
        type: 'string'
      },
      preview: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'summary', 'items'],
        properties: {
          title: {
            type: 'string'
          },
          summary: {
            type: 'string'
          },
          items: {
            type: 'array',
            items: {
              type: 'string'
            }
          }
        }
      },
      riskLevel: {
        type: 'string',
        enum: ['low', 'medium', 'high']
      },
      payload: {
        type: 'object',
        additionalProperties: true
      }
    }
  }
};

const webSearchTool = {
  type: 'web_search_preview' as const,
  search_context_size: 'medium' as const
};

function parseJsonObject(argumentsText: string) {
  try {
    return JSON.parse(argumentsText);
  } catch {
    return null;
  }
}

function inferGroupTitle(previewTitle: string) {
  const trimmed = previewTitle.trim();
  const prefixedMatch = /^(?:Create group|Proposed tab group):\s*(.+)$/.exec(
    trimmed
  );
  const quotedMatch =
    /tab group(?: named)?\s+['"](.+?)['"]/i.exec(trimmed) ??
    /^['"](.+?)['"]\s*\(\d+\s+tabs?\)$/i.exec(trimmed);
  const candidate = prefixedMatch?.[1] ?? quotedMatch?.[1];

  if (!candidate) {
    return undefined;
  }

  const normalized = candidate
    .trim()
    .replace(/^['"](.+?)['"]\s*\(\d+\s+tabs?\)$/i, '$1')
    .replace(/\s*\(\d+\s+tabs?\)$/i, '')
    .replace(/^['"]|['"]$/g, '')
    .trim();

  return normalized || undefined;
}

function getTabsAttachment(attachments: ContextAttachment[]) {
  return (
    attachments.find((attachment) => attachment.kind === 'tabs') ?? null
  ) as Extract<ContextAttachment, { kind: 'tabs' }> | null;
}

function getPayloadTabIds(payload: Record<string, unknown>) {
  const collected: number[] = [];

  if (Array.isArray(payload.tabIds)) {
    collected.push(
      ...payload.tabIds.filter(
        (value): value is number => typeof value === 'number'
      )
    );
  }

  if (typeof payload.tabId === 'number') {
    collected.push(payload.tabId);
  }

  if (Array.isArray(payload.groups)) {
    for (const group of payload.groups) {
      if (!group || typeof group !== 'object') {
        continue;
      }

      const tabIds = (group as { tabIds?: unknown }).tabIds;

      if (!Array.isArray(tabIds)) {
        continue;
      }

      collected.push(
        ...tabIds.filter((value): value is number => typeof value === 'number')
      );
    }
  }

  return [...new Set(collected)];
}

function toTabGroupKey(url: string) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return parsed.hostname.toLowerCase().replace(/^www\./, '');
    }

    return parsed.protocol.toLowerCase();
  } catch {
    return null;
  }
}

const GROUP_COLOR_SEQUENCE = [
  'blue',
  'green',
  'purple',
  'orange',
  'cyan',
  'yellow',
  'pink',
  'red',
  'grey'
] as const;

type TabGroupingCategory =
  | 'work'
  | 'research'
  | 'shopping'
  | 'media'
  | 'social'
  | 'finance'
  | 'travel'
  | 'misc';

type GroupTabsPayloadGroup = {
  tabIds: number[];
  title?: string;
  color?: string;
};

function titleCase(value: string) {
  return value
    .split(/[\s-_]+/)
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(' ');
}

function toRootDomain(hostname: string) {
  const parts = hostname.toLowerCase().split('.').filter(Boolean);

  if (parts.length >= 2) {
    return parts.slice(-2).join('.');
  }

  return parts[0] ?? hostname.toLowerCase();
}

function classifyTab(
  tab: Extract<ContextAttachment, { kind: 'tabs' }>['tabs'][number]
): TabGroupingCategory {
  const title = tab.title.toLowerCase();
  const url = tab.url.toLowerCase();
  let hostname = '';
  let pathname = '';

  try {
    const parsed = new URL(tab.url);
    hostname = parsed.hostname.toLowerCase();
    pathname = parsed.pathname.toLowerCase();
  } catch {
    hostname = '';
    pathname = '';
  }

  const combined = `${hostname} ${pathname} ${title} ${url}`;

  if (
    /github|gitlab|bitbucket|localhost|127\.0\.0\.1|vercel|netlify|supabase|firebase|jira|linear|notion|slack|docs?\.|developer|dev\.to|stackoverflow|stackexchange|npmjs|tailwind|react|typescript/.test(
      combined
    )
  ) {
    return 'work';
  }

  if (
    /google\.com\/search|duckduckgo|bing\.com\/search|wikipedia|arxiv|medium\.com|substack|scholar|pubmed|documentation|tutorial|guide/.test(
      combined
    )
  ) {
    return 'research';
  }

  if (
    /amazon|jumia|konga|ebay|etsy|aliexpress|walmart|target|bestbuy|shop|store|checkout|cart|product/.test(
      combined
    )
  ) {
    return 'shopping';
  }

  if (
    /youtube|youtu\.be|netflix|primevideo|spotify|soundcloud|apple\.com\/music|twitch|vimeo|podcast|movie|series|video/.test(
      combined
    )
  ) {
    return 'media';
  }

  if (
    /x\.com|twitter|facebook|instagram|tiktok|reddit|linkedin|discord|whatsapp|telegram|messenger|gmail|outlook|mail/.test(
      combined
    )
  ) {
    return 'social';
  }

  if (
    /bank|finance|crypto|coinbase|binance|kraken|trading|invest|stock|wallet/.test(
      combined
    )
  ) {
    return 'finance';
  }

  if (
    /maps\.google|booking|airbnb|expedia|tripadvisor|uber|lyft|flight|hotel|travel/.test(
      combined
    )
  ) {
    return 'travel';
  }

  return 'misc';
}

function categoryTitle(category: TabGroupingCategory) {
  switch (category) {
    case 'work':
      return 'Work';
    case 'research':
      return 'Research';
    case 'shopping':
      return 'Shopping';
    case 'media':
      return 'Media';
    case 'social':
      return 'Social';
    case 'finance':
      return 'Finance';
    case 'travel':
      return 'Travel';
    case 'misc':
    default:
      return 'General';
  }
}

function categoryColor(category: TabGroupingCategory) {
  switch (category) {
    case 'work':
      return 'blue';
    case 'research':
      return 'purple';
    case 'shopping':
      return 'orange';
    case 'media':
      return 'red';
    case 'social':
      return 'cyan';
    case 'finance':
      return 'green';
    case 'travel':
      return 'yellow';
    case 'misc':
    default:
      return 'grey';
  }
}

function normalizePayloadGroups(
  payload: Record<string, unknown>,
  allowedTabIds: Set<number>
) {
  if (!Array.isArray(payload.groups)) {
    return [];
  }

  const seenTabIds = new Set<number>();
  const groups: GroupTabsPayloadGroup[] = [];

  for (const rawGroup of payload.groups) {
    if (!rawGroup || typeof rawGroup !== 'object') {
      continue;
    }

    const tabIdsRaw = (rawGroup as { tabIds?: unknown }).tabIds;

    if (!Array.isArray(tabIdsRaw)) {
      continue;
    }

    const tabIds = [...new Set(
      tabIdsRaw.filter(
        (value): value is number => typeof value === 'number'
      )
    )].filter((tabId) => allowedTabIds.has(tabId) && !seenTabIds.has(tabId));

    if (tabIds.length < 2) {
      continue;
    }

    for (const tabId of tabIds) {
      seenTabIds.add(tabId);
    }

    const title =
      typeof (rawGroup as { title?: unknown }).title === 'string' &&
      (rawGroup as { title: string }).title.trim().length > 0
        ? (rawGroup as { title: string }).title.trim()
        : undefined;
    const color =
      typeof (rawGroup as { color?: unknown }).color === 'string'
        ? (rawGroup as { color: string }).color
        : undefined;

    groups.push({
      tabIds,
      ...(title ? { title } : {}),
      ...(color ? { color } : {})
    });
  }

  return groups;
}

function buildCategoryGroups(
  tabs: Extract<ContextAttachment, { kind: 'tabs' }>['tabs']
) {
  const categoryBuckets = new Map<TabGroupingCategory, number[]>();

  for (const tab of tabs) {
    const category = classifyTab(tab);
    const current = categoryBuckets.get(category) ?? [];
    current.push(tab.tabId);
    categoryBuckets.set(category, current);
  }

  const groups: GroupTabsPayloadGroup[] = [];
  for (const [category, tabIds] of categoryBuckets.entries()) {
    if (tabIds.length < 2) {
      continue;
    }

    groups.push({
      tabIds,
      title: categoryTitle(category),
      color: categoryColor(category)
    });
  }

  return groups;
}

function buildDomainGroups(
  tabs: Extract<ContextAttachment, { kind: 'tabs' }>['tabs']
) {
  const domainBuckets = new Map<string, number[]>();

  for (const tab of tabs) {
    try {
      const hostname = new URL(tab.url).hostname;
      const key = toRootDomain(hostname);
      const current = domainBuckets.get(key) ?? [];
      current.push(tab.tabId);
      domainBuckets.set(key, current);
    } catch {
      continue;
    }
  }

  const groups: GroupTabsPayloadGroup[] = [];
  for (const [domain, tabIds] of domainBuckets.entries()) {
    if (tabIds.length < 2) {
      continue;
    }

    groups.push({
      tabIds,
      title: titleCase(domain.replace(/\.[a-z0-9]+$/i, '')),
      color: undefined
    });
  }

  return groups;
}

function withColors(groups: GroupTabsPayloadGroup[]) {
  return groups.map((group, index) => ({
    ...group,
    color:
      typeof group.color === 'string' && group.color.length > 0
        ? group.color
        : GROUP_COLOR_SEQUENCE[index % GROUP_COLOR_SEQUENCE.length]
  }));
}

function normalizeGroupTabsPayload(
  payload: Record<string, unknown>,
  attachments: ContextAttachment[],
  previewTitle: string
) {
  const tabsAttachment = getTabsAttachment(attachments);

  if (!tabsAttachment || tabsAttachment.tabs.length === 0) {
    return payload;
  }

  const availableTabIds = tabsAttachment.tabs.map((tab) => tab.tabId);
  const availableTabIdSet = new Set(availableTabIds);
  const explicitGroups = normalizePayloadGroups(payload, availableTabIdSet);
  const explicitGroupTabIds = explicitGroups.flatMap((group) => group.tabIds);
  const requestedTabIds = getPayloadTabIds(payload).filter((tabId) =>
    availableTabIdSet.has(tabId)
  );

  if (explicitGroups.length >= 2) {
    return {
      ...payload,
      groups: withColors(explicitGroups),
      tabIds: explicitGroupTabIds
    };
  }

  let normalizedTabIds = requestedTabIds;

  if (requestedTabIds.length < 2 && tabsAttachment.tabs.length > 1) {
    if (requestedTabIds.length === 1) {
      const seedTab = tabsAttachment.tabs.find(
        (tab) => tab.tabId === requestedTabIds[0]
      );
      const seedGroupKey = seedTab ? toTabGroupKey(seedTab.url) : null;

      if (seedGroupKey) {
        const relatedTabIds = tabsAttachment.tabs
          .filter((tab) => toTabGroupKey(tab.url) === seedGroupKey)
          .map((tab) => tab.tabId);

        if (relatedTabIds.length >= 2) {
          normalizedTabIds = relatedTabIds;
        }
      }
    }

    if (normalizedTabIds.length < 2) {
      const tabIdsByGroupKey = new Map<string, number[]>();

      for (const tab of tabsAttachment.tabs) {
        const groupKey = toTabGroupKey(tab.url);

        if (!groupKey) {
          continue;
        }

        const current = tabIdsByGroupKey.get(groupKey) ?? [];
        current.push(tab.tabId);
        tabIdsByGroupKey.set(groupKey, current);
      }

      let largestRelatedGroup: number[] = [];
      for (const tabIds of tabIdsByGroupKey.values()) {
        if (tabIds.length > largestRelatedGroup.length) {
          largestRelatedGroup = tabIds;
        }
      }

      normalizedTabIds =
        largestRelatedGroup.length >= 2 ? largestRelatedGroup : availableTabIds;
    }
  }

  const shouldAttemptGlobalGrouping =
    requestedTabIds.length < 2 && tabsAttachment.tabs.length >= 3;
  const selectedTabIds = shouldAttemptGlobalGrouping
    ? availableTabIds
    : requestedTabIds.length >= 2
      ? requestedTabIds
      : normalizedTabIds;
  const selectedTabIdSet = new Set(selectedTabIds);
  const selectedTabs = tabsAttachment.tabs.filter((tab) =>
    selectedTabIdSet.has(tab.tabId)
  );

  if (selectedTabs.length >= 3) {
    const categoryGroups = buildCategoryGroups(selectedTabs);
    const semanticGroups =
      categoryGroups.length >= 2 ? categoryGroups : buildDomainGroups(selectedTabs);

    if (semanticGroups.length >= 2) {
      const groups = withColors(semanticGroups);

      return {
        ...payload,
        groups,
        tabIds: groups.flatMap((group) => group.tabIds)
      };
    }
  }

  const normalizedTitle =
    typeof payload.title === 'string' && payload.title.trim().length > 0
      ? payload.title
      : inferGroupTitle(previewTitle);

  return {
    ...payload,
    tabIds: normalizedTabIds,
    ...(normalizedTitle ? { title: normalizedTitle } : {})
  };
}

function repairActionProposalDraft(
  raw: unknown,
  attachments: ContextAttachment[]
): ActionProposalDraft | null {
  const parsedWithoutPayload =
    actionProposalDraftWithoutPayloadSchema.safeParse(raw);

  if (!parsedWithoutPayload.success) {
    return null;
  }

  if (parsedWithoutPayload.data.kind !== 'groupTabs') {
    return null;
  }

  const tabsAttachment = getTabsAttachment(attachments);

  if (!tabsAttachment || tabsAttachment.tabs.length === 0) {
    return null;
  }

  return {
    ...parsedWithoutPayload.data,
    payload: normalizeGroupTabsPayload(
      {
        tabIds: tabsAttachment.tabs.map((tab) => tab.tabId)
      },
      attachments,
      parsedWithoutPayload.data.preview.title
    )
  };
}

function parseActionProposalDraft(
  argumentsText: string,
  attachments: ContextAttachment[]
) {
  const raw = parseJsonObject(argumentsText);

  if (!raw) {
    return null;
  }

  const parsed = actionProposalDraftSchema.safeParse(raw);

  if (parsed.success) {
    if (parsed.data.kind !== 'groupTabs') {
      return parsed.data;
    }

    return {
      ...parsed.data,
      payload: normalizeGroupTabsPayload(
        parsed.data.payload,
        attachments,
        parsed.data.preview.title
      )
    };
  }

  return repairActionProposalDraft(raw, attachments);
}

function parseWebSearchArgs(input: unknown) {
  if (!input || typeof input !== 'object') {
    return {};
  }

  const action = (input as { action?: unknown }).action;

  if (!action || typeof action !== 'object') {
    return {};
  }

  const query =
    typeof (action as { query?: unknown }).query === 'string'
      ? (action as { query: string }).query
      : undefined;
  const queries = Array.isArray((action as { queries?: unknown }).queries)
    ? (action as { queries: unknown[] }).queries.filter(
        (value): value is string => typeof value === 'string'
      )
    : [];

  if (!query && queries.length === 0) {
    return {};
  }

  return {
    query,
    queries: queries.length > 0 ? queries : undefined
  };
}

function parseWebSearchResult(input: unknown) {
  if (!input || typeof input !== 'object') {
    return undefined;
  }

  const action = (input as { action?: unknown }).action;

  if (!action || typeof action !== 'object') {
    return undefined;
  }

  const sources: Array<{ title?: string; url?: string }> = [];

  if (Array.isArray((action as { sources?: unknown }).sources)) {
    for (const source of (action as { sources: unknown[] }).sources) {
      if (!source || typeof source !== 'object') {
        continue;
      }

      const title =
        typeof (source as { title?: unknown }).title === 'string'
          ? (source as { title: string }).title
          : undefined;
      const url =
        typeof (source as { url?: unknown }).url === 'string'
          ? (source as { url: string }).url
          : undefined;

      if (!title && !url) {
        continue;
      }

      sources.push({
        title,
        url
      });
    }
  }

  if (sources.length === 0) {
    return undefined;
  }

  return {
    sources
  };
}

function hasTabsContext(attachments: ContextAttachment[]) {
  const tabsAttachment = getTabsAttachment(attachments);
  return Boolean(tabsAttachment && tabsAttachment.tabs.length > 0);
}

function isTabActionRequest(content: string) {
  const normalized = content.toLowerCase();
  const hasActionVerb =
    /\b(group|organize|organise|categorize|categorise|sort|arrange|move|close|focus)\b/.test(
      normalized
    );

  if (hasActionVerb && /\btabs?\b/.test(normalized)) {
    return true;
  }

  if (hasActionVerb && /\b(them|those|these|it)\b/.test(normalized)) {
    return true;
  }

  return /\b(go ahead|do it|apply(?: them| it)?|proceed|confirm|yes)\b/.test(
    normalized
  );
}

const WEB_SEARCH_INTENT_PATTERN =
  /\b(search|lookup|look up|find(?: online)?|web|internet|price|prices|availability|available|latest|current|today|alternatives?|compare|youtube|yt|rank(?:ed|ing)?|relevance|links?|urls?)\b/;
const WEB_SEARCH_CONTINUATION_PATTERN =
  /\b(go(?:\s+|[-])?(?:ahead|ahread)|do it|apply(?: them| it)?|proceed|continue|confirm|yes|sure|ok(?:ay)?)\b/;
const WEB_SEARCH_ASSISTANT_COMMITMENT_PATTERN =
  /\b(i can search|i(?:'| a)m ready to search|ready.*search|return the top|with links|timestamps?)\b/;
const WEB_SEARCH_DISCOVERY_PATTERN =
  /\b(top\s*\d+|most relevant|by relevance|rank(?:ed|ing)?|with links?|direct links?|source links?)\b/;
const WEB_SEARCH_DISCOVERY_ENTITY_PATTERN =
  /\b(videos?|channels?|playlists?|articles?|posts?|resources?|tutorials?)\b/;
const YOUTUBE_REFERENCE_PATTERN = /\b(youtube|youtu\.be|\byt\b)\b/;
const YOUTUBE_LINK_REQUEST_PATTERN =
  /\b(?:direct|actual|real)\s+(?:youtube|yt|youtu\.be)\s+(?:links?|urls?)\b|\b(?:youtube|yt|youtu\.be)\s+(?:links?|urls?)\b|\b(?:links?|urls?)\s+to\s+(?:youtube|yt|youtu\.be)\b/;
const RETRY_PATTERN =
  /\b(retry|try again|again|rerun|re-run|redo|go(?:\s+|[-])?(?:ahead|ahread))\b/;
const TRANSCRIPT_DETAIL_REQUEST_PATTERN =
  /\b(transcript|captions?|subtitles?|timestamp(?:s)?|timecode(?:s)?|quote|quotes|verbatim|exact words?|what did (?:he|she|they) say|where (?:in|at) (?:the )?video|source evidence|evidence source)\b/;

function hasRecentWebSearchContext(messages: ConversationMessage[]) {
  const recentMessages = [...messages].slice(-6);

  return recentMessages.some((message) => {
    const normalized = message.content.toLowerCase();

    return (
      WEB_SEARCH_INTENT_PATTERN.test(normalized) ||
      WEB_SEARCH_ASSISTANT_COMMITMENT_PATTERN.test(normalized)
    );
  });
}

function shouldEnableWebSearchTool(
  content: string,
  messages: ConversationMessage[]
) {
  if (WEB_SEARCH_INTENT_PATTERN.test(content)) {
    return true;
  }

  if (
    WEB_SEARCH_DISCOVERY_PATTERN.test(content) &&
    WEB_SEARCH_DISCOVERY_ENTITY_PATTERN.test(content)
  ) {
    return true;
  }

  if (!WEB_SEARCH_CONTINUATION_PATTERN.test(content)) {
    return false;
  }

  return hasRecentWebSearchContext(messages);
}

function hasRecentYouTubeContext(messages: ConversationMessage[]) {
  const recentMessages = [...messages].slice(-8);

  return recentMessages.some((message) =>
    YOUTUBE_REFERENCE_PATTERN.test(message.content.toLowerCase())
  );
}

function shouldUseYouTubeDirectLinkPolicy(
  content: string,
  messages: ConversationMessage[]
) {
  if (YOUTUBE_LINK_REQUEST_PATTERN.test(content)) {
    return true;
  }

  if (
    YOUTUBE_REFERENCE_PATTERN.test(content) &&
    WEB_SEARCH_INTENT_PATTERN.test(content)
  ) {
    return true;
  }

  return RETRY_PATTERN.test(content) && hasRecentYouTubeContext(messages);
}

function shouldSurfaceTranscriptDetails(
  content: string,
  messages: ConversationMessage[]
) {
  if (TRANSCRIPT_DETAIL_REQUEST_PATTERN.test(content)) {
    return true;
  }

  if (!WEB_SEARCH_CONTINUATION_PATTERN.test(content)) {
    return false;
  }

  const recentMessages = [...messages].slice(-6);
  return recentMessages.some((message) =>
    TRANSCRIPT_DETAIL_REQUEST_PATTERN.test(message.content.toLowerCase())
  );
}

function buildFallbackTabGroupingProposal(
  attachments: ContextAttachment[]
): ActionProposalDraft | null {
  const tabsAttachment = getTabsAttachment(attachments);

  if (!tabsAttachment || tabsAttachment.tabs.length < 2) {
    return null;
  }

  const payload = normalizeGroupTabsPayload(
    {
      tabIds: tabsAttachment.tabs.map((tab) => tab.tabId),
      title: 'Related tabs'
    },
    attachments,
    'Group tabs by category'
  );
  const candidateGroups = Array.isArray(payload.groups)
    ? payload.groups.filter(
        (
          group
        ): group is {
          title?: string;
          tabIds: number[];
        } =>
          Boolean(
            group &&
              typeof group === 'object' &&
              Array.isArray((group as { tabIds?: unknown }).tabIds) &&
              (group as { tabIds: unknown[] }).tabIds.every(
                (value) => typeof value === 'number'
              ) &&
              (group as { tabIds: unknown[] }).tabIds.length > 0
          )
      )
    : [];

  if (candidateGroups.length >= 2) {
    return {
      kind: 'groupTabs',
      reason: 'Grouped tabs in the current window by related topic.',
      preview: {
        title: `Group tabs into ${candidateGroups.length} categories`,
        summary: `Create ${candidateGroups.length} related groups from the current window tabs.`,
        items: candidateGroups.slice(0, 8).map((group) => {
          const label =
            typeof group.title === 'string' && group.title.trim().length > 0
              ? group.title
              : 'Group';
          return `${label} (${group.tabIds.length} tabs)`;
        })
      },
      riskLevel: 'low',
      payload
    };
  }

  const tabIds = getPayloadTabIds(payload);

  if (tabIds.length < 2) {
    return null;
  }

  const selectedTabs = tabsAttachment.tabs.filter((tab) =>
    tabIds.includes(tab.tabId)
  );
  const title =
    typeof payload.title === 'string' && payload.title.trim().length > 0
      ? payload.title
      : 'Related tabs';

  return {
    kind: 'groupTabs',
    reason: 'Grouped related tabs in the current window.',
    preview: {
      title: `Create "${title}" tab group`,
      summary: `Group ${tabIds.length} related tabs in the current window.`,
      items: selectedTabs
        .slice(0, 8)
        .map((tab) => `${tab.title} — ${tab.url}`)
    },
    riskLevel: 'low',
    payload: {
      ...payload,
      tabIds,
      title
    }
  };
}

function chunkAssistantMessage(message: string) {
  const chunks: string[] = [];
  const sections = message.split(/(\n\n+)/).filter((section) => section.length);
  let current = '';

  for (const section of sections) {
    if ((current + section).length > 120 && current.length > 0) {
      chunks.push(current);
      current = section;
      continue;
    }

    current += section;
  }

  if (current.length > 0) {
    chunks.push(current);
  }

  if (chunks.length > 1 || message.length <= 120) {
    return chunks;
  }

  const wordChunks: string[] = [];
  let wordBuffer = '';

  for (const token of message.split(/(\s+)/).filter((part) => part.length)) {
    if ((wordBuffer + token).length > 80 && wordBuffer.length > 0) {
      wordChunks.push(wordBuffer);
      wordBuffer = token;
      continue;
    }

    wordBuffer += token;
  }

  if (wordBuffer.length > 0) {
    wordChunks.push(wordBuffer);
  }

  return wordChunks;
}

export class MockModelGateway implements ModelGateway {
  constructor(private readonly response: MockModelGatewayResponse) {}

  async *streamTurn(
    input: ModelGatewayTurnInput
  ): AsyncGenerator<ModelGatewayStreamEvent> {
    const result =
      typeof this.response === 'function'
        ? await this.response(input)
        : this.response;

    for (const chunk of chunkAssistantMessage(result.assistantMessage)) {
      if (!chunk) {
        continue;
      }

      yield {
        type: 'message_delta',
        delta: chunk
      };
    }

    for (const proposal of result.proposals) {
      yield {
        type: 'proposal',
        proposal
      };
    }
  }
}

export class OpenAIModelGateway implements ModelGateway {
  private readonly client: OpenAI;
  private readonly model: string;
  private readonly defaultProposals: ActionProposalDraft[];

  constructor(options: OpenAIModelGatewayOptions) {
    this.client = new OpenAI({
      apiKey: options.apiKey
    });
    this.model = options.model ?? 'gpt-5-mini';
    this.defaultProposals = options.defaultProposals ?? [];
  }

  async *streamTurn(
    input: ModelGatewayTurnInput
  ): AsyncGenerator<ModelGatewayStreamEvent> {
    const normalizedUserMessage = input.userMessage.content.toLowerCase();
    const shouldForceActionProposal =
      hasTabsContext(input.transientAttachments) &&
      isTabActionRequest(normalizedUserMessage);
    const shouldUseDirectYouTubeLinkPolicy = shouldUseYouTubeDirectLinkPolicy(
      normalizedUserMessage,
      input.messages
    );
    const shouldSurfaceTranscriptMeta = shouldSurfaceTranscriptDetails(
      normalizedUserMessage,
      input.messages
    );
    const enabledTools = shouldEnableWebSearchTool(
      normalizedUserMessage,
      input.messages
    )
      ? [actionProposalTool, webSearchTool]
      : [actionProposalTool];

    const stream = this.client.responses.stream({
      model: this.model,
      tools: enabledTools,
      tool_choice: shouldForceActionProposal
        ? {
            type: 'function',
            name: 'create_action_proposal'
          }
        : undefined,
      input: [
        {
          role: 'system',
          content: [
            {
              type: 'input_text',
              text: [
                'You are Riv, a browser-side assistant.',
                'Reply with concise, well-structured markdown.',
                'Keep answers concise, but ground claims in the provided evidence.',
                'Use short headings and bullets when the answer has multiple parts.',
                'Prefer transcript evidence over description inference for YouTube media.',
                'If the user asks about video or page content, summarize the main point first and support it with concise evidence.',
                'For YouTube/video summaries, do not call out transcript availability, transcript failures, or extraction internals unless the user explicitly asks.',
                'If the user asks for a browser action or operational task, fulfill that request directly and do not preface the reply with a page or video summary unless they asked for one.',
                'When the user requests a supported tab-management action and the provided context includes enough tab or tab-group information, call create_action_proposal with the exact action you recommend.',
                'Do not ask for confirmation in prose when using create_action_proposal; the UI will present the confirmation controls.',
                'When the user asks for current web facts (prices, availability, recent updates, external catalog checks), use web search before answering.',
                'After web search, include concrete source links in the reply.',
                ...(shouldSurfaceTranscriptMeta
                  ? [
                      'When the user explicitly asks for transcript details, include timestamps when available.',
                      'If transcript data is missing for a transcript-specific request, state that clearly and then continue with the best available evidence.'
                    ]
                  : []),
                'Do not wrap the full reply in code fences.',
                'Do not invent browser actions unless the server provides them separately.',
                ...(shouldUseDirectYouTubeLinkPolicy
                  ? [
                      'For YouTube requests, only present direct YouTube video links (`https://www.youtube.com/watch?v=...` or `https://youtu.be/...`) as the primary links.',
                      'Do not present transcript mirrors or summary sites as the primary video links.',
                      'If direct YouTube URLs are not available in search results, explicitly say that and ask to retry; do not claim success.'
                    ]
                  : [])
              ].join(' ')
            }
          ]
        },
        {
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: JSON.stringify({
                thread: input.thread,
                userMessage: input.userMessage,
                recentMessages: input.messages.slice(-6),
                memories: input.memories,
                transientAttachments: input.transientAttachments
              })
            }
          ]
        }
      ]
    });

    let emittedText = false;
    let emittedProposal = false;
    const functionCallNames = new Map<number, string>();
    const functionCallArgumentDeltas = new Map<number, string>();
    const webSearchIdsByOutputIndex = new Map<number, string>();
    const startedWebSearchInvocations = new Set<string>();
    const finishedWebSearchInvocations = new Set<string>();

    for await (const event of stream) {
      if (event.type === 'response.output_text.delta' && event.delta) {
        emittedText = true;
        yield {
          type: 'message_delta',
          delta: event.delta
        };
        continue;
      }

      if (
        event.type === 'response.output_item.added' &&
        typeof event.output_index === 'number'
      ) {
        if (event.item.type === 'function_call') {
          functionCallNames.set(event.output_index, event.item.name);
          continue;
        }

        if (event.item.type === 'web_search_call') {
          webSearchIdsByOutputIndex.set(event.output_index, event.item.id);

          if (!startedWebSearchInvocations.has(event.item.id)) {
            startedWebSearchInvocations.add(event.item.id);
            yield {
              type: 'tool_started',
              invocation: {
                id: event.item.id,
                tool: 'searchWeb',
                kind: 'read',
                args: parseWebSearchArgs(event.item)
              }
            };
          }
        }

        continue;
      }

      if (
        (event.type === 'response.web_search_call.in_progress' ||
          event.type === 'response.web_search_call.searching') &&
        typeof event.item_id === 'string'
      ) {
        if (typeof event.output_index === 'number') {
          webSearchIdsByOutputIndex.set(event.output_index, event.item_id);
        }

        if (!startedWebSearchInvocations.has(event.item_id)) {
          startedWebSearchInvocations.add(event.item_id);
          yield {
            type: 'tool_started',
            invocation: {
              id: event.item_id,
              tool: 'searchWeb',
              kind: 'read',
              args: {}
            }
          };
        }

        continue;
      }

      if (
        event.type === 'response.web_search_call.completed' &&
        typeof event.item_id === 'string'
      ) {
        if (!startedWebSearchInvocations.has(event.item_id)) {
          startedWebSearchInvocations.add(event.item_id);
          yield {
            type: 'tool_started',
            invocation: {
              id: event.item_id,
              tool: 'searchWeb',
              kind: 'read',
              args: {}
            }
          };
        }

        if (!finishedWebSearchInvocations.has(event.item_id)) {
          finishedWebSearchInvocations.add(event.item_id);
          yield {
            type: 'tool_finished',
            invocation: {
              id: event.item_id,
              tool: 'searchWeb',
              kind: 'read',
              args: {},
              result: {
                status: 'completed'
              }
            }
          };
        }

        continue;
      }

      if (
        event.type === 'response.function_call_arguments.delta' &&
        typeof event.output_index === 'number' &&
        event.delta
      ) {
        const previous = functionCallArgumentDeltas.get(event.output_index) ?? '';
        functionCallArgumentDeltas.set(event.output_index, previous + event.delta);
        continue;
      }

      if (
        event.type === 'response.function_call_arguments.done'
      ) {
        const functionName =
          event.name ??
          (typeof event.output_index === 'number'
            ? functionCallNames.get(event.output_index)
            : undefined);
        const argumentsText =
          event.arguments ||
          (typeof event.output_index === 'number'
            ? functionCallArgumentDeltas.get(event.output_index)
            : undefined);

        if (functionName !== 'create_action_proposal' || !argumentsText) {
          continue;
        }

        const proposal = parseActionProposalDraft(
          argumentsText,
          input.transientAttachments
        );

        if (!proposal) {
          continue;
        }

        if (typeof event.output_index === 'number') {
          functionCallArgumentDeltas.delete(event.output_index);
        }

        emittedProposal = true;
        yield {
          type: 'proposal',
          proposal
        };
        continue;
      }

      if (
        event.type === 'response.output_item.done' &&
        event.item.type === 'web_search_call'
      ) {
        const invocationId =
          event.item.id ||
          (typeof event.output_index === 'number'
            ? webSearchIdsByOutputIndex.get(event.output_index)
            : undefined);

        if (!invocationId) {
          continue;
        }

        const args = parseWebSearchArgs(event.item);

        if (!startedWebSearchInvocations.has(invocationId)) {
          startedWebSearchInvocations.add(invocationId);
          yield {
            type: 'tool_started',
            invocation: {
              id: invocationId,
              tool: 'searchWeb',
              kind: 'read',
              args
            }
          };
        }

        if (!finishedWebSearchInvocations.has(invocationId)) {
          finishedWebSearchInvocations.add(invocationId);
          yield {
            type: 'tool_finished',
            invocation: {
              id: invocationId,
              tool: 'searchWeb',
              kind: 'read',
              args,
              result:
                parseWebSearchResult(event.item) ?? { status: event.item.status },
              error:
                event.item.status === 'failed' ? 'Web search failed.' : undefined
            }
          };
        }

        continue;
      }

      if (
        event.type === 'response.output_item.done' &&
        event.item.type === 'function_call' &&
        event.item.name === 'create_action_proposal'
      ) {
        const proposal = parseActionProposalDraft(
          event.item.arguments,
          input.transientAttachments
        );

        if (!proposal || emittedProposal) {
          continue;
        }

        emittedProposal = true;
        yield {
          type: 'proposal',
          proposal
        };
      }
    }

    if (!emittedText && !emittedProposal && shouldForceActionProposal) {
      const fallbackProposal = buildFallbackTabGroupingProposal(
        input.transientAttachments
      );

      if (fallbackProposal) {
        emittedProposal = true;
        yield {
          type: 'proposal',
          proposal: fallbackProposal
        };
      }
    }

    if (!emittedText && !emittedProposal) {
      yield {
        type: 'message_delta',
        delta: "I didn't get a usable response from the model. Send that again."
      };
    }

    for (const proposal of this.defaultProposals) {
      yield {
        type: 'proposal',
        proposal
      };
    }
  }
}
