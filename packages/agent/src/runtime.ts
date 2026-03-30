import {
  PROTOCOL_VERSION,
  type ActionConfirmation,
  type ActionExecutionResult,
  type ContextAttachment,
  type ConversationMessage,
  type ConversationThread,
  type MessageEnvelope,
  type ToolInvocation
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
  RunStatelessAssistantTurnInput,
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

function createUserMessage(input: {
  id: string;
  threadId: string;
  content: string;
  createdAt: string;
}): ConversationMessage {
  return {
    id: input.id,
    threadId: input.threadId,
    role: 'user',
    content: input.content,
    attachments: [],
    toolInvocations: [],
    createdAt: input.createdAt
  };
}

function assertMessagesBelongToThread(
  messages: ConversationMessage[],
  threadId: string
) {
  const mismatchedMessage = messages.find(
    (message) => message.threadId !== threadId
  );

  if (mismatchedMessage) {
    throw new AgentRuntimeError(
      'Stateless turn messages must belong to the supplied thread.',
      400
    );
  }
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
    const userMessage = createUserMessage({
      id: this.idGenerator('message_user'),
      threadId: thread.id,
      content: input.content,
      createdAt: timestamp
    });

    await this.messages.append(userMessage);

    const priorMessages = await this.messages.listByThreadId(thread.id);
    const assistantResponse = yield* this.streamTurnWithContext({
      userId: input.userId,
      thread,
      messages: priorMessages,
      userMessage,
      attachments: input.attachments,
      persistProposals: true
    });

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

  async *runStatelessAssistantTurn(
    input: RunStatelessAssistantTurnInput
  ): AsyncGenerator<MessageEnvelope> {
    const thread: ConversationThread = {
      ...input.thread,
      userId: input.userId
    };

    assertMessagesBelongToThread(input.messages, thread.id);

    const userMessage = createUserMessage({
      id: this.idGenerator('message_user'),
      threadId: thread.id,
      content: input.content,
      createdAt: this.now()
    });

    yield* this.streamTurnWithContext({
      userId: input.userId,
      thread,
      messages: [...input.messages, userMessage],
      userMessage,
      attachments: input.attachments,
      persistProposals: false
    });
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

  private async *streamTurnWithContext(input: {
    userId: string;
    thread: ConversationThread;
    messages: ConversationMessage[];
    userMessage: ConversationMessage;
    attachments: ContextAttachment[];
    persistProposals: boolean;
  }): AsyncGenerator<MessageEnvelope, string> {
    const memories = await this.memories.listByUserId(input.userId);
    let assistantResponse = '';
    const activeToolInvocations = new Map<string, ToolInvocation>();

    for await (const event of this.modelGateway.streamTurn({
      thread: input.thread,
      messages: input.messages,
      userMessage: input.userMessage,
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

      if (event.type === 'tool_started') {
        const startedAt = this.now();
        const invocation: ToolInvocation = {
          id: event.invocation.id,
          tool: event.invocation.tool,
          kind: event.invocation.kind,
          state: 'started',
          args: event.invocation.args,
          createdAt: startedAt
        };
        activeToolInvocations.set(invocation.id, invocation);

        yield createEnvelope(
          {
            type: 'tool_started',
            invocation
          },
          startedAt
        );
        continue;
      }

      if (event.type === 'tool_finished') {
        const completedAt = this.now();
        const startedInvocation = activeToolInvocations.get(event.invocation.id);
        const invocation: ToolInvocation = {
          id: event.invocation.id,
          tool: event.invocation.tool,
          kind: event.invocation.kind,
          state: event.invocation.error ? 'failed' : 'completed',
          args: startedInvocation?.args ?? event.invocation.args,
          result: event.invocation.result,
          error: event.invocation.error,
          createdAt: startedInvocation?.createdAt ?? completedAt,
          completedAt
        };
        activeToolInvocations.delete(event.invocation.id);

        yield createEnvelope(
          {
            type: 'tool_finished',
            invocation
          },
          completedAt
        );
        continue;
      }

      const proposalTimestamp = this.now();
      const proposal: StoredActionProposal = {
        id: this.idGenerator('proposal'),
        threadId: input.thread.id,
        kind: event.proposal.kind,
        reason: event.proposal.reason,
        preview: event.proposal.preview,
        riskLevel: event.proposal.riskLevel,
        requiresConfirmation: true,
        payload: event.proposal.payload,
        createdAt: proposalTimestamp,
        status: 'pending'
      };

      if (input.persistProposals) {
        await this.proposals.create(proposal);
      }

      yield createEnvelope(
        {
          type: 'proposal_created',
          proposal
        },
        proposalTimestamp
      );
    }

    return assistantResponse;
  }
}

export function createAgentRuntime(options: AgentRuntimeOptions) {
  return new AgentRuntime(options);
}
