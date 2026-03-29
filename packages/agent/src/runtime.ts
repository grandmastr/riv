import {
  PROTOCOL_VERSION,
  type ActionConfirmation,
  type ActionExecutionResult,
  type ConversationMessage,
  type ConversationThread,
  type MessageEnvelope
} from '@riv/contracts';

import { AgentRuntimeError } from './errors';
import {
  InMemoryActionProposalRepository,
  InMemoryMemoryRepository,
  InMemoryMessageRepository,
  InMemoryThreadRepository,
  type ActionProposalRepository,
  type MemoryRepository,
  type MessageRepository,
  type ThreadRepository
} from './repositories';
import type {
  CreateMemoryInput,
  CreateThreadInput,
  MemoryRecord,
  ModelGateway,
  ProposalResolution,
  ResolveProposalInput,
  RunAssistantTurnInput,
  StoredActionProposal,
  ThreadDetail,
  ViewerScopedInput
} from './types';

export type AgentRuntimeOptions = {
  now?: () => string;
  idGenerator?: (prefix: string) => string;
  modelGateway: ModelGateway;
  repositories?: {
    threads?: ThreadRepository;
    messages?: MessageRepository;
    proposals?: ActionProposalRepository;
    memories?: MemoryRepository;
  };
};

export function createSequenceIdGenerator(ids: string[]) {
  return (prefix: string) => {
    const matchingIndex = ids.findIndex((id) => id.startsWith(`${prefix}_`));

    if (matchingIndex >= 0) {
      const nextId = ids.splice(matchingIndex, 1)[0];

      if (nextId) {
        return nextId;
      }
    }

    return `${prefix}_${crypto.randomUUID()}`;
  };
}

function defaultIdGenerator(prefix: string) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function createEnvelope(
  payload: MessageEnvelope['payload'],
  emittedAt: string
): MessageEnvelope {
  return {
    version: PROTOCOL_VERSION,
    type: 'assistant_stream',
    emittedAt,
    payload
  };
}

function collectAffectedTabs(proposal: StoredActionProposal) {
  const tabIds = Array.isArray(proposal.payload.tabIds)
    ? proposal.payload.tabIds
    : typeof proposal.payload.tabId === 'number'
      ? [proposal.payload.tabId]
      : [];

  return tabIds
    .filter((value): value is number => typeof value === 'number')
    .map((tabId) => ({
      tabId
    }));
}

async function assertOwnedThread(
  repository: ThreadRepository,
  threadId: string,
  userId: string
) {
  const thread = await repository.findById(threadId);

  if (!thread) {
    throw new AgentRuntimeError(`Thread ${threadId} was not found.`, 404);
  }

  if (thread.userId !== userId) {
    throw new AgentRuntimeError(
      'Thread access is not allowed for this viewer.',
      403
    );
  }

  return thread;
}

export class AgentRuntime {
  private readonly now: () => string;
  private readonly idGenerator: (prefix: string) => string;
  private readonly modelGateway: ModelGateway;
  private readonly threads: ThreadRepository;
  private readonly messages: MessageRepository;
  private readonly proposals: ActionProposalRepository;
  private readonly memories: MemoryRepository;

  constructor(options: AgentRuntimeOptions) {
    this.now = options.now ?? (() => new Date().toISOString());
    this.idGenerator = options.idGenerator ?? defaultIdGenerator;
    this.modelGateway = options.modelGateway;
    this.threads =
      options.repositories?.threads ?? new InMemoryThreadRepository();
    this.messages =
      options.repositories?.messages ?? new InMemoryMessageRepository();
    this.proposals =
      options.repositories?.proposals ?? new InMemoryActionProposalRepository();
    this.memories =
      options.repositories?.memories ?? new InMemoryMemoryRepository();
  }

  async createThread(input: CreateThreadInput) {
    const timestamp = this.now();
    const thread: ConversationThread = {
      id: this.idGenerator('thread'),
      userId: input.userId,
      title: input.title,
      createdAt: timestamp,
      updatedAt: timestamp
    };

    await this.threads.create(thread);
    return thread;
  }

  async getThreadDetail(
    input: ViewerScopedInput & { threadId: string }
  ): Promise<ThreadDetail> {
    const thread = await assertOwnedThread(
      this.threads,
      input.threadId,
      input.userId
    );
    const messages = await this.messages.listByThreadId(thread.id);
    const actionProposals = await this.proposals.listByThreadId(thread.id);

    return {
      thread,
      messages,
      actionProposals
    };
  }

  async *runAssistantTurn(
    input: RunAssistantTurnInput
  ): AsyncGenerator<MessageEnvelope> {
    const thread = await assertOwnedThread(
      this.threads,
      input.threadId,
      input.userId
    );
    const timestamp = this.now();
    const userMessage: ConversationMessage = {
      id: this.idGenerator('message_user'),
      threadId: thread.id,
      role: 'user',
      content: input.content,
      attachments: [],
      toolInvocations: [],
      createdAt: timestamp
    };

    await this.messages.append(userMessage);

    const priorMessages = await this.messages.listByThreadId(thread.id);
    const memories = await this.memories.listByUserId(input.userId);
    let assistantResponse = '';

    for await (const event of this.modelGateway.streamTurn({
      thread,
      messages: priorMessages,
      userMessage,
      transientAttachments: input.attachments,
      memories
    })) {
      if (event.type === 'message_delta') {
        assistantResponse += event.delta;

        yield createEnvelope(
          {
            type: 'message_delta',
            delta: event.delta
          },
          this.now()
        );
        continue;
      }

      const proposalTimestamp = this.now();
      const proposal: StoredActionProposal = {
        id: this.idGenerator('proposal'),
        threadId: thread.id,
        kind: event.proposal.kind,
        reason: event.proposal.reason,
        preview: event.proposal.preview,
        riskLevel: event.proposal.riskLevel,
        requiresConfirmation: true,
        payload: event.proposal.payload,
        createdAt: proposalTimestamp,
        status: 'pending'
      };

      await this.proposals.create(proposal);

      yield createEnvelope(
        {
          type: 'proposal_created',
          proposal
        },
        proposalTimestamp
      );
    }

    if (assistantResponse.trim()) {
      const assistantMessage: ConversationMessage = {
        id: this.idGenerator('message_assistant'),
        threadId: thread.id,
        role: 'assistant',
        content: assistantResponse,
        attachments: [],
        toolInvocations: [],
        createdAt: timestamp
      };

      await this.messages.append(assistantMessage);
    }
  }

  async confirmActionProposal(
    input: ResolveProposalInput
  ): Promise<ProposalResolution> {
    const thread = await assertOwnedThread(
      this.threads,
      input.threadId,
      input.actorUserId
    );
    const proposal = await this.proposals.findById(thread.id, input.proposalId);

    if (!proposal) {
      throw new AgentRuntimeError(
        `Proposal ${input.proposalId} was not found.`,
        404
      );
    }

    const timestamp = this.now();
    const confirmation: ActionConfirmation = {
      proposalId: proposal.id,
      threadId: thread.id,
      decision: 'confirm',
      actorUserId: input.actorUserId,
      confirmedAt: timestamp
    };

    const result: ActionExecutionResult = {
      proposalId: proposal.id,
      status: 'executed',
      summary: `Executed ${proposal.kind}.`,
      affectedTabs: collectAffectedTabs(proposal),
      executedAt: timestamp
    };

    const updated: StoredActionProposal = {
      ...proposal,
      status: 'executed',
      confirmation,
      executionResult: result
    };

    await this.proposals.update(updated);

    return {
      proposal: updated,
      confirmation,
      result
    };
  }

  async rejectActionProposal(
    input: ResolveProposalInput
  ): Promise<ProposalResolution> {
    const thread = await assertOwnedThread(
      this.threads,
      input.threadId,
      input.actorUserId
    );
    const proposal = await this.proposals.findById(thread.id, input.proposalId);

    if (!proposal) {
      throw new AgentRuntimeError(
        `Proposal ${input.proposalId} was not found.`,
        404
      );
    }

    const timestamp = this.now();
    const confirmation: ActionConfirmation = {
      proposalId: proposal.id,
      threadId: thread.id,
      decision: 'reject',
      actorUserId: input.actorUserId,
      confirmedAt: timestamp
    };

    const result: ActionExecutionResult = {
      proposalId: proposal.id,
      status: 'rejected',
      summary: `Rejected ${proposal.kind}.`,
      affectedTabs: collectAffectedTabs(proposal),
      executedAt: timestamp
    };

    const updated: StoredActionProposal = {
      ...proposal,
      status: 'rejected',
      confirmation,
      executionResult: result
    };

    await this.proposals.update(updated);

    return {
      proposal: updated,
      confirmation,
      result
    };
  }

  async listMemories(input: ViewerScopedInput): Promise<MemoryRecord[]> {
    return this.memories.listByUserId(input.userId);
  }

  async createMemory(input: CreateMemoryInput): Promise<MemoryRecord> {
    const timestamp = this.now();
    const memory: MemoryRecord = {
      id: this.idGenerator('memory'),
      userId: input.userId,
      title: input.title,
      content: input.content,
      createdAt: timestamp,
      updatedAt: timestamp
    };

    await this.memories.create(memory);
    return memory;
  }
}

export function createAgentRuntime(options: AgentRuntimeOptions) {
  return new AgentRuntime(options);
}
