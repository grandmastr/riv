import type {
  ActionConfirmation,
  ActionExecutionResult,
  ActionProposal,
  ContextAttachment,
  ConversationMessage,
  ConversationThread
} from '@riv/contracts';

export type ProposalStatus = 'pending' | 'executed' | 'rejected' | 'failed';

export type StoredActionProposal = ActionProposal & {
  status: ProposalStatus;
  confirmation?: ActionConfirmation;
  executionResult?: ActionExecutionResult;
};

export type MemoryRecord = {
  id: string;
  userId: string;
  title: string;
  content: string;
  createdAt: string;
  updatedAt: string;
};

export type ThreadDetail = {
  thread: ConversationThread;
  messages: ConversationMessage[];
  actionProposals: StoredActionProposal[];
};

export type ViewerScopedInput = {
  userId: string;
};

export type CreateThreadInput = ViewerScopedInput & {
  title: string;
};

export type RunAssistantTurnInput = ViewerScopedInput & {
  threadId: string;
  content: string;
  attachments: ContextAttachment[];
};

export type CreateMemoryInput = ViewerScopedInput & {
  title: string;
  content: string;
};

export type ResolveProposalInput = {
  actorUserId: string;
  proposalId: string;
  threadId: string;
};

export type ProposalResolution = {
  proposal: StoredActionProposal;
  confirmation: ActionConfirmation;
  result: ActionExecutionResult;
};

export type ActionProposalDraft = Pick<
  ActionProposal,
  'kind' | 'reason' | 'preview' | 'riskLevel' | 'payload'
>;

export type ModelGatewayTurnInput = {
  thread: ConversationThread;
  messages: ConversationMessage[];
  userMessage: ConversationMessage;
  transientAttachments: ContextAttachment[];
  memories: MemoryRecord[];
};

export type ModelGatewayTurnResult = {
  assistantMessage: string;
  proposals: ActionProposalDraft[];
};

export type ModelGatewayStreamEvent =
  | {
      type: 'message_delta';
      delta: string;
    }
  | {
      type: 'proposal';
      proposal: ActionProposalDraft;
    };

export interface ModelGateway {
  streamTurn(
    input: ModelGatewayTurnInput
  ): AsyncGenerator<ModelGatewayStreamEvent>;
}
