import { and, asc, eq } from 'drizzle-orm';
import type {
  ActionProposalRepository,
  MemoryRepository,
  MemoryRecord,
  MessageRepository,
  StoredActionProposal,
  ThreadRepository
} from '@riv/agent';
import type { ConversationMessage, ConversationThread } from '@riv/contracts';

import {
  type RivActionProposalRow,
  rivActionProposals,
  rivMemories,
  rivMessages,
  rivThreads
} from '../../../../drizzle/schema';
import type { RivDatabase } from './client';

function toStoredActionProposal(
  proposal: RivActionProposalRow
): StoredActionProposal {
  return {
    ...proposal,
    requiresConfirmation: true,
    confirmation: proposal.confirmation ?? undefined,
    executionResult: proposal.executionResult ?? undefined
  };
}

export class DrizzleThreadRepository implements ThreadRepository {
  constructor(private readonly db: RivDatabase) {}

  async create(thread: ConversationThread) {
    await this.db.insert(rivThreads).values(thread);
  }

  async findById(id: string) {
    const [thread] = await this.db
      .select()
      .from(rivThreads)
      .where(eq(rivThreads.id, id))
      .limit(1);

    return thread ?? null;
  }
}

export class DrizzleMessageRepository implements MessageRepository {
  constructor(private readonly db: RivDatabase) {}

  async append(message: ConversationMessage) {
    await this.db.insert(rivMessages).values(message);
  }

  async listByThreadId(threadId: string) {
    return this.db
      .select()
      .from(rivMessages)
      .where(eq(rivMessages.threadId, threadId))
      .orderBy(asc(rivMessages.createdAt));
  }
}

export class DrizzleActionProposalRepository implements ActionProposalRepository {
  constructor(private readonly db: RivDatabase) {}

  async create(proposal: StoredActionProposal) {
    await this.db.insert(rivActionProposals).values({
      ...proposal,
      confirmation: proposal.confirmation ?? null,
      executionResult: proposal.executionResult ?? null
    });
  }

  async findById(threadId: string, proposalId: string) {
    const [proposal] = await this.db
      .select()
      .from(rivActionProposals)
      .where(
        and(
          eq(rivActionProposals.threadId, threadId),
          eq(rivActionProposals.id, proposalId)
        )
      )
      .limit(1);

    return proposal ? toStoredActionProposal(proposal) : null;
  }

  async listByThreadId(threadId: string) {
    const proposals = await this.db
      .select()
      .from(rivActionProposals)
      .where(eq(rivActionProposals.threadId, threadId))
      .orderBy(asc(rivActionProposals.createdAt));

    return proposals.map(toStoredActionProposal);
  }

  async update(proposal: StoredActionProposal) {
    await this.db
      .update(rivActionProposals)
      .set({
        kind: proposal.kind,
        reason: proposal.reason,
        preview: proposal.preview,
        riskLevel: proposal.riskLevel,
        requiresConfirmation: proposal.requiresConfirmation,
        payload: proposal.payload,
        createdAt: proposal.createdAt,
        status: proposal.status,
        confirmation: proposal.confirmation ?? null,
        executionResult: proposal.executionResult ?? null
      })
      .where(
        and(
          eq(rivActionProposals.id, proposal.id),
          eq(rivActionProposals.threadId, proposal.threadId)
        )
      );
  }
}

export class DrizzleMemoryRepository implements MemoryRepository {
  constructor(private readonly db: RivDatabase) {}

  async create(memory: MemoryRecord) {
    await this.db.insert(rivMemories).values(memory);
  }

  async listByUserId(userId: string) {
    return this.db
      .select()
      .from(rivMemories)
      .where(eq(rivMemories.userId, userId))
      .orderBy(asc(rivMemories.updatedAt));
  }
}
