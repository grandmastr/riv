import type { ConversationMessage, ConversationThread } from '@riv/contracts';

import type { MemoryRecord, StoredActionProposal } from './types';

export interface ThreadRepository {
  create(thread: ConversationThread): Promise<void>;
  findById(id: string): Promise<ConversationThread | null>;
}

export interface MessageRepository {
  append(message: ConversationMessage): Promise<void>;
  listByThreadId(threadId: string): Promise<ConversationMessage[]>;
}

export interface ActionProposalRepository {
  create(proposal: StoredActionProposal): Promise<void>;
  findById(
    threadId: string,
    proposalId: string
  ): Promise<StoredActionProposal | null>;
  listByThreadId(threadId: string): Promise<StoredActionProposal[]>;
  update(proposal: StoredActionProposal): Promise<void>;
}

export interface MemoryRepository {
  create(memory: MemoryRecord): Promise<void>;
  listByUserId(userId: string): Promise<MemoryRecord[]>;
}

export class InMemoryThreadRepository implements ThreadRepository {
  private readonly threads = new Map<string, ConversationThread>();

  async create(thread: ConversationThread) {
    this.threads.set(thread.id, thread);
  }

  async findById(id: string) {
    return this.threads.get(id) ?? null;
  }
}

export class InMemoryMessageRepository implements MessageRepository {
  private readonly messages = new Map<string, ConversationMessage[]>();

  async append(message: ConversationMessage) {
    const existing = this.messages.get(message.threadId) ?? [];
    existing.push(message);
    this.messages.set(message.threadId, existing);
  }

  async listByThreadId(threadId: string) {
    return [...(this.messages.get(threadId) ?? [])];
  }
}

export class InMemoryActionProposalRepository implements ActionProposalRepository {
  private readonly proposals = new Map<string, StoredActionProposal[]>();

  async create(proposal: StoredActionProposal) {
    const existing = this.proposals.get(proposal.threadId) ?? [];
    existing.push(proposal);
    this.proposals.set(proposal.threadId, existing);
  }

  async findById(threadId: string, proposalId: string) {
    return (
      this.proposals
        .get(threadId)
        ?.find((proposal) => proposal.id === proposalId) ?? null
    );
  }

  async listByThreadId(threadId: string) {
    return [...(this.proposals.get(threadId) ?? [])];
  }

  async update(proposal: StoredActionProposal) {
    const existing = this.proposals.get(proposal.threadId) ?? [];
    const index = existing.findIndex((item) => item.id === proposal.id);

    if (index >= 0) {
      existing[index] = proposal;
      this.proposals.set(proposal.threadId, existing);
    }
  }
}

export class InMemoryMemoryRepository implements MemoryRepository {
  private readonly memories = new Map<string, MemoryRecord[]>();

  async create(memory: MemoryRecord) {
    const existing = this.memories.get(memory.userId) ?? [];
    existing.push(memory);
    this.memories.set(memory.userId, existing);
  }

  async listByUserId(userId: string) {
    return [...(this.memories.get(userId) ?? [])];
  }
}
