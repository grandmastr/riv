import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp
} from 'drizzle-orm/pg-core';
import type {
  ActionConfirmation,
  ActionExecutionResult,
  ActionProposal,
  ConversationMessage,
  ConversationThread,
  ToolInvocation
} from '@riv/contracts';
import type { MemoryRecord } from '@riv/agent';

const messageRoleEnum = pgEnum('message_role', [
  'user',
  'assistant',
  'tool',
  'system'
]);

const actionKindEnum = pgEnum('action_kind', [
  'groupTabs',
  'moveTabs',
  'closeTabs',
  'focusTab'
]);

const riskLevelEnum = pgEnum('risk_level', ['low', 'medium', 'high']);
const proposalStatusEnum = pgEnum('proposal_status', [
  'pending',
  'executed',
  'rejected',
  'failed'
]);

const timestampColumn = (name: string) =>
  timestamp(name, {
    mode: 'string',
    withTimezone: true
  }).notNull();

export const rivThreads = pgTable(
  'riv_threads',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    title: text('title').notNull(),
    createdAt: timestampColumn('created_at'),
    updatedAt: timestampColumn('updated_at')
  },
  (table) => [index('riv_threads_user_id_idx').on(table.userId)]
);

export const rivMessages = pgTable(
  'riv_messages',
  {
    id: text('id').primaryKey(),
    threadId: text('thread_id')
      .notNull()
      .references(() => rivThreads.id, { onDelete: 'cascade' }),
    role: messageRoleEnum('role').notNull(),
    content: text('content').notNull(),
    attachments: jsonb('attachments')
      .$type<ConversationMessage['attachments']>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    toolInvocations: jsonb('tool_invocations')
      .$type<ToolInvocation[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    createdAt: timestampColumn('created_at')
  },
  (table) => [
    index('riv_messages_thread_created_idx').on(table.threadId, table.createdAt)
  ]
);

export const rivActionProposals = pgTable(
  'riv_action_proposals',
  {
    id: text('id').primaryKey(),
    threadId: text('thread_id')
      .notNull()
      .references(() => rivThreads.id, { onDelete: 'cascade' }),
    kind: actionKindEnum('kind').notNull(),
    reason: text('reason').notNull(),
    preview: jsonb('preview').$type<ActionProposal['preview']>().notNull(),
    riskLevel: riskLevelEnum('risk_level').notNull(),
    requiresConfirmation: boolean('requires_confirmation')
      .notNull()
      .default(true),
    payload: jsonb('payload').$type<ActionProposal['payload']>().notNull(),
    createdAt: timestampColumn('created_at'),
    status: proposalStatusEnum('status').notNull(),
    confirmation: jsonb('confirmation').$type<ActionConfirmation | null>(),
    executionResult: jsonb(
      'execution_result'
    ).$type<ActionExecutionResult | null>()
  },
  (table) => [
    index('riv_action_proposals_thread_created_idx').on(
      table.threadId,
      table.createdAt
    )
  ]
);

export const rivMemories = pgTable(
  'riv_memories',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    title: text('title').notNull(),
    content: text('content').notNull(),
    createdAt: timestampColumn('created_at'),
    updatedAt: timestampColumn('updated_at')
  },
  (table) => [
    index('riv_memories_user_updated_idx').on(table.userId, table.updatedAt)
  ]
);

export type RivThreadRow = typeof rivThreads.$inferSelect;
export type RivMessageRow = typeof rivMessages.$inferSelect;
export type RivActionProposalRow = typeof rivActionProposals.$inferSelect;
export type RivMemoryRow = typeof rivMemories.$inferSelect;

type ThreadShapeCheck = RivThreadRow extends ConversationThread ? true : never;
type MessageShapeCheck = RivMessageRow extends ConversationMessage
  ? true
  : never;
type MemoryShapeCheck = RivMemoryRow extends MemoryRecord ? true : never;

export const schemaShapeChecks: [
  ThreadShapeCheck,
  MessageShapeCheck,
  MemoryShapeCheck
] = [true, true, true];
