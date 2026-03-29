import { z } from 'zod';

export const PROTOCOL_VERSION = '2026-03-29' as const;

const IsoDateTimeSchema = z.iso.datetime();
const UrlSchema = z.url();
const JsonRecordSchema = z.record(z.string(), z.string());

export const BrowserToolNameSchema = z.enum([
  'readActivePage',
  'readSelection',
  'listTabs',
  'listTabGroups',
  'proposeTabGrouping',
  'groupTabs',
  'moveTabs',
  'closeTabs',
  'focusTab'
]);

export const ContentBlockSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(['heading', 'paragraph', 'list', 'code', 'quote', 'metadata']),
  text: z.string(),
  level: z.number().int().min(1).max(6).optional()
});

export const PageContextSnapshotSchema = z.object({
  tabId: z.number().int().nonnegative(),
  url: UrlSchema,
  title: z.string(),
  pageType: z.enum([
    'article',
    'dashboard',
    'documentation',
    'form',
    'generic',
    'search',
    'social'
  ]),
  capturedAt: IsoDateTimeSchema,
  metadata: JsonRecordSchema,
  contentBlocks: z.array(ContentBlockSchema)
});

export const SelectedTextContextSchema = z.object({
  tabId: z.number().int().nonnegative(),
  url: UrlSchema,
  title: z.string(),
  text: z.string().min(1),
  capturedAt: IsoDateTimeSchema
});

export const BrowserTabSummarySchema = z.object({
  tabId: z.number().int().nonnegative(),
  windowId: z.number().int().nonnegative(),
  index: z.number().int().nonnegative(),
  url: UrlSchema,
  title: z.string(),
  active: z.boolean(),
  pinned: z.boolean(),
  groupId: z.number().int(),
  favIconUrl: UrlSchema.optional()
});

export const BrowserTabGroupSummarySchema = z.object({
  groupId: z.number().int().nonnegative(),
  windowId: z.number().int().nonnegative(),
  title: z.string(),
  color: z.enum([
    'grey',
    'blue',
    'red',
    'yellow',
    'green',
    'pink',
    'purple',
    'cyan',
    'orange'
  ]),
  collapsed: z.boolean(),
  tabIds: z.array(z.number().int().nonnegative())
});

export const ConversationThreadSchema = z.object({
  id: z.string().min(1),
  userId: z.string().min(1),
  title: z.string().min(1),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema
});

export const ActionPreviewSchema = z.object({
  title: z.string().min(1),
  summary: z.string().min(1),
  items: z.array(z.string())
});

export const ActionProposalSchema = z.object({
  id: z.string().min(1),
  threadId: z.string().min(1),
  kind: z.enum(['groupTabs', 'moveTabs', 'closeTabs', 'focusTab']),
  reason: z.string().min(1),
  preview: ActionPreviewSchema,
  riskLevel: z.enum(['low', 'medium', 'high']),
  requiresConfirmation: z.literal(true),
  payload: z.record(z.string(), z.unknown()),
  createdAt: IsoDateTimeSchema
});

export const ActionConfirmationSchema = z.object({
  proposalId: z.string().min(1),
  threadId: z.string().min(1),
  decision: z.enum(['confirm', 'reject']),
  actorUserId: z.string().min(1),
  confirmedAt: IsoDateTimeSchema
});

export const AffectedTabSchema = z.object({
  tabId: z.number().int().nonnegative(),
  url: UrlSchema.optional(),
  title: z.string().optional()
});

export const ActionExecutionResultSchema = z.object({
  proposalId: z.string().min(1),
  status: z.enum(['executed', 'rejected', 'failed']),
  summary: z.string().min(1),
  affectedTabs: z.array(AffectedTabSchema),
  error: z.string().optional(),
  executedAt: IsoDateTimeSchema
});

export const ContextAttachmentSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('page'),
    snapshot: PageContextSnapshotSchema
  }),
  z.object({
    kind: z.literal('selection'),
    selection: SelectedTextContextSchema
  }),
  z.object({
    kind: z.literal('tabs'),
    tabs: z.array(BrowserTabSummarySchema)
  }),
  z.object({
    kind: z.literal('tabGroups'),
    tabGroups: z.array(BrowserTabGroupSummarySchema)
  }),
  z.object({
    kind: z.literal('actionResult'),
    result: ActionExecutionResultSchema
  })
]);

export const ToolInvocationSchema = z.object({
  id: z.string().min(1),
  tool: BrowserToolNameSchema,
  kind: z.enum(['read', 'write']),
  state: z.enum(['started', 'completed', 'failed']),
  args: z.record(z.string(), z.unknown()),
  result: z.unknown().optional(),
  error: z.string().optional(),
  createdAt: IsoDateTimeSchema,
  completedAt: IsoDateTimeSchema.optional()
});

export const ConversationMessageSchema = z.object({
  id: z.string().min(1),
  threadId: z.string().min(1),
  role: z.enum(['user', 'assistant', 'tool', 'system']),
  content: z.string(),
  attachments: z.array(ContextAttachmentSchema).default([]),
  toolInvocations: z.array(ToolInvocationSchema).default([]),
  createdAt: IsoDateTimeSchema
});

export const AssistantStreamEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('message_delta'),
    delta: z.string()
  }),
  z.object({
    type: z.literal('tool_started'),
    invocation: ToolInvocationSchema
  }),
  z.object({
    type: z.literal('tool_finished'),
    invocation: ToolInvocationSchema
  }),
  z.object({
    type: z.literal('proposal_created'),
    proposal: ActionProposalSchema
  }),
  z.object({
    type: z.literal('action_completed'),
    result: ActionExecutionResultSchema
  }),
  z.object({
    type: z.literal('error'),
    message: z.string().min(1),
    code: z.string().optional()
  })
]);

export const MessageEnvelopeSchema = z.object({
  version: z.literal(PROTOCOL_VERSION),
  type: z.enum(['assistant_stream']),
  emittedAt: IsoDateTimeSchema,
  payload: AssistantStreamEventSchema
});

export type BrowserToolName = z.infer<typeof BrowserToolNameSchema>;
export type ContentBlock = z.infer<typeof ContentBlockSchema>;
export type PageContextSnapshot = z.infer<typeof PageContextSnapshotSchema>;
export type SelectedTextContext = z.infer<typeof SelectedTextContextSchema>;
export type BrowserTabSummary = z.infer<typeof BrowserTabSummarySchema>;
export type BrowserTabGroupSummary = z.infer<
  typeof BrowserTabGroupSummarySchema
>;
export type ConversationThread = z.infer<typeof ConversationThreadSchema>;
export type ConversationMessage = z.infer<typeof ConversationMessageSchema>;
export type ContextAttachment = z.infer<typeof ContextAttachmentSchema>;
export type ToolInvocation = z.infer<typeof ToolInvocationSchema>;
export type ActionProposal = z.infer<typeof ActionProposalSchema>;
export type ActionConfirmation = z.infer<typeof ActionConfirmationSchema>;
export type ActionExecutionResult = z.infer<typeof ActionExecutionResultSchema>;
export type AssistantStreamEvent = z.infer<typeof AssistantStreamEventSchema>;
export type MessageEnvelope = z.infer<typeof MessageEnvelopeSchema>;
