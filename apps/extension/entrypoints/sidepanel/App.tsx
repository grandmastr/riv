import { useEffect, useState } from 'react';

import type {
  ActionConfirmation,
  ActionExecutionResult,
  ActionProposal,
  BrowserTabGroupSummary,
  BrowserTabSummary,
  ContextAttachment,
  ConversationMessage,
  ConversationThread,
  DashboardAutomationsResponse,
  DashboardOverviewResponse,
  GoogleIntegrationStatus,
  PageContextSnapshot,
  SelectedTextContext
} from '@riv/contracts';

import {
  connectGoogleIntegration,
  disconnectGoogleIntegration,
  dismissDashboardSuggestion,
  getDashboardAutomations,
  getDashboardOverview,
  getGoogleIntegrationStatus,
  sendStatelessTurn,
  updateDashboardAutomationSettings
} from '../../src/lib/api-client';
import { handleSidePanelShortcutKeydown } from '../../src/content/shortcut-handler';
import { getConversationStore } from '../../src/lib/local-conversation-store';
import {
  requestSidePanelToggle,
  type RivBackgroundResponse,
  sendBackgroundMessage,
  subscribeToPreparedSelection
} from '../../src/lib/messages';
import {
  RivSidepanel,
  type PendingTaskItem,
  type RivSurfaceTab
} from '../../src/sidepanel/panel';

const VIEWER_ID = 'user_dev';

function createLocalMessage(input: {
  id: string;
  threadId: string;
  role: ConversationMessage['role'];
  content: string;
  attachments?: ContextAttachment[];
  createdAt?: string;
}) {
  return {
    id: input.id,
    threadId: input.threadId,
    role: input.role,
    content: input.content,
    attachments: input.attachments ?? [],
    toolInvocations: [],
    createdAt: input.createdAt ?? new Date().toISOString()
  } satisfies ConversationMessage;
}

function createActionResultAttachment(
  result: ActionExecutionResult
): ContextAttachment {
  return {
    kind: 'actionResult',
    result
  };
}

function createLocalThread(title: string): ConversationThread {
  const timestamp = new Date().toISOString();

  return {
    id: `thread_${crypto.randomUUID()}`,
    userId: VIEWER_ID,
    title,
    createdAt: timestamp,
    updatedAt: timestamp
  };
}

function upsertById<T extends { id: string }>(items: T[], nextItem: T) {
  const index = items.findIndex((item) => item.id === nextItem.id);

  if (index < 0) {
    return [...items, nextItem];
  }

  const nextItems = [...items];
  nextItems[index] = nextItem;
  return nextItems;
}

function upsertThreadById(
  items: ConversationThread[],
  nextThread: ConversationThread
) {
  return [...items.filter((item) => item.id !== nextThread.id), nextThread]
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

function collectPendingTasks(details: Array<{
  threadId: string;
  proposals: ActionProposal[];
}>): PendingTaskItem[] {
  return details
    .flatMap(({ threadId, proposals }) =>
      proposals.map((proposal) => ({
        proposalId: proposal.id,
        threadId,
        title: proposal.preview.title,
        summary: proposal.preview.summary,
        riskLevel: proposal.riskLevel,
        createdAt: proposal.createdAt
      }))
    )
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

type ThreadSummaryMap = Record<string, string>;

function toThreadSummary(messages: ConversationMessage[]) {
  const latestMessage = [...messages]
    .reverse()
    .find((message) => message.content.trim().length > 0);

  if (!latestMessage) {
    return null;
  }

  const normalized = latestMessage.content
    .replace(/[#>*`_[\]()-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!normalized) {
    return null;
  }

  if (normalized.length <= 110) {
    return normalized;
  }

  return `${normalized.slice(0, 107).trimEnd()}...`;
}

function toErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return 'Riva hit an unexpected error.';
}

function stripTransientAttachments(attachments: ContextAttachment[]) {
  return attachments.filter(
    (attachment) =>
      attachment.kind !== 'page' && attachment.kind !== 'selection'
      && attachment.kind !== 'tabs' && attachment.kind !== 'tabGroups'
  );
}

const TAB_ACTION_VERB_PATTERN =
  /\b(group|organize|organise|categorize|categorise|sort|arrange|move|close|focus|clean up|cleanup)\b/;
const TAB_REFERENCE_PATTERN = /\b(tabs?|them|those|these|it)\b/;
const TAB_CONTINUATION_PATTERN =
  /\b(go ahead|do it|apply(?: them| it)?|proceed|confirm|yes)\b/;
const TAB_ASSISTANT_CONTEXT_PATTERN =
  /\b(tab|tabs|tab group|group(?:ing)?|organize|organise|arrange|sort)\b/;

function hasRecentTabAssistantContext(recentMessages: ConversationMessage[]) {
  const assistantMessages = [...recentMessages]
    .reverse()
    .filter((message) => message.role === 'assistant')
    .slice(0, 4);

  return assistantMessages.some((message) =>
    TAB_ASSISTANT_CONTEXT_PATTERN.test(message.content.toLowerCase())
  );
}

function isTabManagementRequest(
  content: string,
  recentMessages: ConversationMessage[]
) {
  const normalized = content.toLowerCase();
  const hasActionVerb = TAB_ACTION_VERB_PATTERN.test(normalized);

  if (hasActionVerb && /\btabs?\b/.test(normalized)) {
    return true;
  }

  const hasRecentTabContext = hasRecentTabAssistantContext(recentMessages);

  if (!hasRecentTabContext) {
    return false;
  }

  return (
    (hasActionVerb && TAB_REFERENCE_PATTERN.test(normalized)) ||
    TAB_CONTINUATION_PATTERN.test(normalized)
  );
}

function getAttachmentScope(
  content: string,
  recentMessages: ConversationMessage[]
) {
  const shouldIncludeTabContext = isTabManagementRequest(
    content,
    recentMessages
  );

  return {
    shouldIncludeTabContext,
    shouldIncludePageContext: !shouldIncludeTabContext,
    shouldIncludeSelection: !shouldIncludeTabContext
  };
}

function formatAttachmentReadLabel(scope: {
  shouldIncludeTabContext: boolean;
  shouldIncludePageContext: boolean;
  shouldIncludeSelection: boolean;
}) {
  if (scope.shouldIncludeTabContext) {
    return 'Reading open tabs...';
  }

  if (scope.shouldIncludePageContext && scope.shouldIncludeSelection) {
    return 'Reading page context...';
  }

  if (scope.shouldIncludePageContext) {
    return 'Reading page context...';
  }

  if (scope.shouldIncludeSelection) {
    return 'Reading selected text...';
  }

  return 'Preparing request...';
}

function formatModelWaitLabel(scope: {
  shouldIncludeTabContext: boolean;
  shouldIncludePageContext: boolean;
  shouldIncludeSelection: boolean;
}) {
  if (scope.shouldIncludeTabContext) {
    return 'Analyzing open tabs...';
  }

  if (scope.shouldIncludePageContext && scope.shouldIncludeSelection) {
    return 'Analyzing page context...';
  }

  if (scope.shouldIncludePageContext) {
    return 'Analyzing page context...';
  }

  if (scope.shouldIncludeSelection) {
    return 'Analyzing selected text...';
  }

  return 'Analyzing request...';
}

function formatOperationLabel(tool: string) {
  switch (tool) {
    case 'searchWeb':
      return 'Searching web...';
    case 'readActivePage':
      return 'Reading page context...';
    case 'readSelection':
      return 'Reading selected text...';
    case 'listTabs':
      return 'Reading open tabs...';
    case 'listTabGroups':
      return 'Reading tab groups...';
    case 'proposeTabGrouping':
      return 'Preparing tab action...';
    case 'groupTabs':
      return 'Grouping tabs...';
    case 'moveTabs':
      return 'Moving tabs...';
    case 'closeTabs':
      return 'Closing tabs...';
    case 'focusTab':
      return 'Focusing tab...';
    default:
      return 'Working...';
  }
}

async function readBackgroundMessageOrNull<T extends RivBackgroundResponse>(
  request: Parameters<typeof sendBackgroundMessage>[0]
) {
  try {
    const scopedRequest = await withCurrentWindowScope(request);
    return await sendBackgroundMessage<T>(scopedRequest);
  } catch (error) {
    console.error(error);
    return null;
  }
}

async function withCurrentWindowScope(
  request: Parameters<typeof sendBackgroundMessage>[0]
) {
  switch (request.type) {
    case 'riv/read-active-page':
    case 'riv/read-selection':
    case 'riv/list-tabs':
    case 'riv/list-tab-groups':
      break;
    default:
      return request;
  }

  if (typeof chrome === 'undefined' || !chrome.windows?.getCurrent) {
    return request;
  }

  try {
    const currentWindow = await chrome.windows.getCurrent();
    if (typeof currentWindow.id !== 'number') {
      return request;
    }

    return {
      ...request,
      windowId: currentWindow.id
    };
  } catch (error) {
    console.error(error);
    return request;
  }
}

export default function App() {
  const conversationStore = getConversationStore();
  const [activeSurface, setActiveSurface] = useState<RivSurfaceTab>('assistant');
  const [thread, setThread] = useState<ConversationThread | null>(null);
  const [threads, setThreads] = useState<ConversationThread[]>([]);
  const [threadSummaries, setThreadSummaries] = useState<ThreadSummaryMap>({});
  const [pendingTasks, setPendingTasks] = useState<PendingTaskItem[]>([]);
  const [pageContext, setPageContext] = useState<PageContextSnapshot | null>(
    null
  );
  const [preparedSelection, setPreparedSelection] =
    useState<SelectedTextContext | null>(null);
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [proposals, setProposals] = useState<ActionProposal[]>([]);
  const [isSending, setIsSending] = useState(false);
  const [pendingOperationLabel, setPendingOperationLabel] = useState<
    string | null
  >(null);
  const [integrationStatus, setIntegrationStatus] =
    useState<GoogleIntegrationStatus | null>(null);
  const [dashboardOverview, setDashboardOverview] =
    useState<DashboardOverviewResponse | null>(null);
  const [dashboardAutomations, setDashboardAutomations] =
    useState<DashboardAutomationsResponse | null>(null);
  const [isDashboardLoading, setIsDashboardLoading] = useState(false);
  const [dashboardError, setDashboardError] = useState<string | null>(null);

  async function refreshThreadCollections(
    listedThreads?: ConversationThread[]
  ) {
    const nextThreads = listedThreads ?? await conversationStore.listThreads();
    setThreads(nextThreads);
    if (nextThreads.length === 0) {
      setPendingTasks([]);
      setThreadSummaries({});
      return;
    }

    const details = await Promise.all(
      nextThreads.map(async (item) => ({
        threadId: item.id,
        detail: await conversationStore.getThreadDetail(item.id)
      }))
    );
    setPendingTasks(
      collectPendingTasks(
        details.map((item) => ({
          threadId: item.threadId,
          proposals: item.detail?.proposals ?? []
        }))
      )
    );

    const nextSummaries = details.reduce<ThreadSummaryMap>((acc, item) => {
      const summary = toThreadSummary(item.detail?.messages ?? []);
      if (summary) {
        acc[item.threadId] = summary;
      }
      return acc;
    }, {});
    setThreadSummaries(nextSummaries);
  }

  async function refreshDashboardData() {
    setDashboardError(null);
    setIsDashboardLoading(true);

    try {
      const [integration, overview, automations] = await Promise.all([
        getGoogleIntegrationStatus(),
        getDashboardOverview(),
        getDashboardAutomations()
      ]);

      setIntegrationStatus(integration);
      setDashboardOverview(overview);
      setDashboardAutomations(automations);
    } catch (error) {
      console.error(error);
      setDashboardError(toErrorMessage(error));
    } finally {
      setIsDashboardLoading(false);
    }
  }

  useEffect(() => {
    void (async () => {
      const [snapshot, selection, localDetail, localThreads] = await Promise.all([
        readBackgroundMessageOrNull<PageContextSnapshot>({
          type: 'riv/read-active-page'
        }),
        readBackgroundMessageOrNull<SelectedTextContext | null>({
          type: 'riv/read-selection'
        }),
        conversationStore.getLatestThreadDetail(),
        conversationStore.listThreads()
      ]);

      if (snapshot) {
        setPageContext(snapshot);
      }

      setPreparedSelection((current) => current ?? selection);
      setThreads(localThreads);
      void refreshThreadCollections(localThreads);

      if (localDetail) {
        setThread(localDetail.thread);
        setMessages(localDetail.messages);
        setProposals(localDetail.proposals);
      }

      await refreshDashboardData();
    })();
  }, [conversationStore]);

  useEffect(() => {
    return subscribeToPreparedSelection((selection) => {
      setPreparedSelection(selection);
    });
  }, []);

  useEffect(() => {
    const handleKeydown = (event: KeyboardEvent) => {
      handleSidePanelShortcutKeydown(
        event,
        () => {
          void requestSidePanelToggle().catch((error: unknown) => {
            console.error(error);
          });
        },
        {
          ignoreEditableTargets: false
        }
      );
    };

    window.addEventListener('keydown', handleKeydown);

    return () => {
      window.removeEventListener('keydown', handleKeydown);
    };
  }, []);

  async function ensureThread() {
    if (thread) {
      return thread;
    }

    const created = createLocalThread(pageContext?.title || 'Riva session');
    await conversationStore.upsertThread(created);
    setThreads((current) => upsertThreadById(current, created));
    setThread(created);
    return created;
  }

  async function touchThread(
    activeThread: ConversationThread,
    updatedAt: string
  ) {
    const nextThread = {
      ...activeThread,
      updatedAt
    } satisfies ConversationThread;

    await conversationStore.upsertThread(nextThread);
    setThreads((current) => upsertThreadById(current, nextThread));
    setThread((current) =>
      current?.id === nextThread.id ? nextThread : current
    );
    return nextThread;
  }

  async function handleCreateChat() {
    const created = createLocalThread(pageContext?.title || 'New chat');
    await conversationStore.upsertThread(created);
    setThread(created);
    setMessages([]);
    setProposals([]);
    setThreads((current) => upsertThreadById(current, created));
  }

  async function handleSelectThread(threadId: string) {
    const localDetail = await conversationStore.getThreadDetail(threadId);

    if (!localDetail) {
      return;
    }

    setThread(localDetail.thread);
    setMessages(localDetail.messages);
    setProposals(localDetail.proposals);
  }

  async function handleDeleteThread(threadId: string) {
    try {
      await conversationStore.deleteThread(threadId);
      const nextThreads = await conversationStore.listThreads();
      await refreshThreadCollections(nextThreads);

      if (thread?.id !== threadId) {
        return;
      }

      const [nextThread] = nextThreads;
      if (!nextThread) {
        setThread(null);
        setMessages([]);
        setProposals([]);
        return;
      }

      const nextDetail = await conversationStore.getThreadDetail(nextThread.id);
      if (!nextDetail) {
        setThread(nextThread);
        setMessages([]);
        setProposals([]);
        return;
      }

      setThread(nextDetail.thread);
      setMessages(nextDetail.messages);
      setProposals(nextDetail.proposals);
    } catch (error) {
      console.error(error);
    }
  }

  async function collectAttachments(
    scope: {
      shouldIncludeTabContext: boolean;
      shouldIncludePageContext: boolean;
      shouldIncludeSelection: boolean;
    }
  ) {
    const attachments: ContextAttachment[] = [];
    const [latestPageContext, selection, tabs, tabGroups] = await Promise.all([
      scope.shouldIncludePageContext
        ? readBackgroundMessageOrNull<PageContextSnapshot>({
            type: 'riv/read-active-page'
          })
        : Promise.resolve(null),
      scope.shouldIncludeSelection
        ? readBackgroundMessageOrNull<SelectedTextContext | null>({
            type: 'riv/read-selection'
          })
        : Promise.resolve(null),
      scope.shouldIncludeTabContext
        ? readBackgroundMessageOrNull<BrowserTabSummary[]>({
            type: 'riv/list-tabs'
          })
        : Promise.resolve(null),
      scope.shouldIncludeTabContext
        ? readBackgroundMessageOrNull<BrowserTabGroupSummary[]>({
            type: 'riv/list-tab-groups'
          })
        : Promise.resolve(null)
    ]);

    if (latestPageContext) {
      setPageContext(latestPageContext);
    }
    setPreparedSelection(selection);

    if (latestPageContext) {
      attachments.push({
        kind: 'page',
        snapshot: latestPageContext
      });
    }

    if (selection) {
      attachments.push({
        kind: 'selection',
        selection
      });
    }

    if (tabs) {
      attachments.push({
        kind: 'tabs',
        tabs
      });
    }

    if (tabGroups) {
      attachments.push({
        kind: 'tabGroups',
        tabGroups
      });
    }

    return attachments;
  }

  async function handleSend(content: string) {
    setIsSending(true);
    setPendingOperationLabel('Preparing request...');

    let activeThread: ConversationThread | null = null;
    let surfacedStreamError = false;

    try {
      activeThread = await ensureThread();
      const localDetail = await conversationStore.getThreadDetail(activeThread.id);
      const priorMessages = localDetail?.messages ?? messages;
      const recentMessages = priorMessages.slice(-6);
      const attachmentScope = getAttachmentScope(content, recentMessages);

      setPendingOperationLabel(formatAttachmentReadLabel(attachmentScope));
      const attachments = await collectAttachments(attachmentScope);
      const userMessage = createLocalMessage({
        id: `local-user-${Date.now()}`,
        threadId: activeThread.id,
        role: 'user',
        content,
        attachments
      });

      setMessages((current) => [...current, userMessage]);
      await conversationStore.upsertMessage({
        ...userMessage,
        attachments: stripTransientAttachments(userMessage.attachments)
      });
      activeThread = await touchThread(activeThread, userMessage.createdAt);
      setPendingOperationLabel(formatModelWaitLabel(attachmentScope));

      const assistantMessageId = `local-assistant-${Date.now()}`;
      const assistantCreatedAt = new Date().toISOString();
      let assistantContent = '';
      let hasSeenToolActivity = false;

      for await (const envelope of sendStatelessTurn({
        thread: activeThread,
        messages: recentMessages,
        content,
        attachments
      })) {
        switch (envelope.payload.type) {
          case 'message_delta': {
            const { delta } = envelope.payload;
            if (!hasSeenToolActivity) {
              setPendingOperationLabel('Drafting response...');
            }
            assistantContent = `${assistantContent}${delta}`;
            const assistantMessage = createLocalMessage({
              id: assistantMessageId,
              threadId: activeThread.id,
              role: 'assistant',
              content: assistantContent,
              createdAt: assistantCreatedAt
            });

            setMessages((current) => upsertById(current, assistantMessage));
            break;
          }
          case 'tool_started': {
            hasSeenToolActivity = true;
            setPendingOperationLabel(
              formatOperationLabel(envelope.payload.invocation.tool)
            );
            break;
          }
          case 'tool_finished': {
            hasSeenToolActivity = true;
            setPendingOperationLabel('Drafting response...');
            break;
          }
          case 'proposal_created': {
            hasSeenToolActivity = true;
            setPendingOperationLabel('Preparing action suggestion...');
            const { proposal } = envelope.payload;

            setProposals((current) => upsertById(current, proposal));
            setPendingTasks((current) =>
              [
                ...current.filter((item) => item.proposalId !== proposal.id),
                {
                  proposalId: proposal.id,
                  threadId: proposal.threadId,
                  title: proposal.preview.title,
                  summary: proposal.preview.summary,
                  riskLevel: proposal.riskLevel,
                  createdAt: proposal.createdAt
                }
              ].sort((left, right) =>
                right.createdAt.localeCompare(left.createdAt)
              )
            );
            await conversationStore.upsertProposal(proposal);
            activeThread = await touchThread(activeThread, proposal.createdAt);
            void refreshThreadCollections();
            void sendBackgroundMessage<ActionProposal>({
              type: 'riv/register-proposal',
              proposal
            }).catch((error: unknown) => {
              console.error(error);
            });
            break;
          }
          case 'error':
            surfacedStreamError = true;
            console.error(envelope.payload.message);
            {
              const errorMessage = createLocalMessage({
                id: `local-error-${Date.now()}`,
                threadId: activeThread.id,
                role: 'assistant',
                content: `Riva couldn't complete that request: ${envelope.payload.message}`
              });

              setMessages((current) => [...current, errorMessage]);
              await conversationStore.upsertMessage(errorMessage);
              await touchThread(activeThread, errorMessage.createdAt);
            }
            break;
          default:
            break;
        }
      }

      if (assistantContent) {
        const assistantMessage = createLocalMessage({
          id: assistantMessageId,
          threadId: activeThread.id,
          role: 'assistant',
          content: assistantContent,
          createdAt: assistantCreatedAt
        });

        await conversationStore.upsertMessage(assistantMessage);
        activeThread = await touchThread(activeThread, assistantCreatedAt);
      }
    } catch (error) {
      console.error(error);
      if (activeThread && !surfacedStreamError) {
        const errorMessage = createLocalMessage({
          id: `local-error-${Date.now()}`,
          threadId: activeThread.id,
          role: 'assistant',
          content: `Riva couldn't complete that request: ${toErrorMessage(error)}`
        });

        setMessages((current) => [...current, errorMessage]);
        await conversationStore.upsertMessage(errorMessage);
        await touchThread(activeThread, errorMessage.createdAt);
      }
    } finally {
      setIsSending(false);
      setPendingOperationLabel(null);
      void refreshThreadCollections();
    }
  }

  async function handleResolveProposal(
    proposalId: string,
    decision: 'confirm' | 'reject'
  ) {
    let activeThread = await ensureThread();
    const proposal = proposals.find((item) => item.id === proposalId);

    if (!proposal) {
      return;
    }

    const confirmation: ActionConfirmation = {
      proposalId,
      threadId: activeThread.id,
      actorUserId: VIEWER_ID,
      decision,
      confirmedAt: new Date().toISOString()
    };

    try {
      await sendBackgroundMessage<ActionProposal>({
        type: 'riv/register-proposal',
        proposal
      });

      const result = await sendBackgroundMessage<ActionExecutionResult>({
        type: 'riv/confirm-proposal',
        confirmation,
        proposal
      });

      if (!result) {
        throw new Error('Riva could not resolve that suggestion. Please try again.');
      }

      const actionMessage = createLocalMessage({
        id: `local-action-${Date.now()}`,
        threadId: activeThread.id,
        role: 'assistant',
        content: result.summary,
        attachments: [createActionResultAttachment(result)]
      });

      setMessages((current) => [...current, actionMessage]);
      setProposals((current) =>
        current.filter((item) => item.id !== proposalId)
      );
      setPendingTasks((current) =>
        current.filter((item) => item.proposalId !== proposalId)
      );
      await conversationStore.removeProposal(activeThread.id, proposalId);
      await conversationStore.upsertMessage(actionMessage);
      activeThread = await touchThread(activeThread, actionMessage.createdAt);
      void refreshThreadCollections();
    } catch (error) {
      console.error(error);
      const errorMessage = createLocalMessage({
        id: `local-error-${Date.now()}`,
        threadId: activeThread.id,
        role: 'assistant',
        content: `Riva couldn't ${decision} that suggestion: ${toErrorMessage(error)}`
      });

      setMessages((current) => [...current, errorMessage]);
      await conversationStore.upsertMessage(errorMessage);
      await touchThread(activeThread, errorMessage.createdAt);
    } finally {
      void refreshThreadCollections();
    }
  }

  async function handleConnectGoogle() {
    setDashboardError(null);

    try {
      const integration = await connectGoogleIntegration();
      setIntegrationStatus(integration);
      await refreshDashboardData();
    } catch (error) {
      console.error(error);
      setDashboardError(toErrorMessage(error));
    }
  }

  async function handleDisconnectGoogle() {
    setDashboardError(null);

    try {
      const integration = await disconnectGoogleIntegration();
      setIntegrationStatus(integration);
      await refreshDashboardData();
    } catch (error) {
      console.error(error);
      setDashboardError(toErrorMessage(error));
    }
  }

  async function handleDismissDashboardSuggestion(suggestionId: string) {
    try {
      const suggestion = await dismissDashboardSuggestion(suggestionId);
      setDashboardOverview((current) => {
        if (!current) {
          return current;
        }

        return {
          ...current,
          gmailSuggestions: current.gmailSuggestions.map((item) =>
            item.id === suggestion.id ? suggestion : item
          )
        };
      });
    } catch (error) {
      console.error(error);
      setDashboardError(toErrorMessage(error));
    }
  }

  async function handleSaveWorkflowSettings(input: {
    meetingReminderOffsetsMinutes: number[];
  }) {
    try {
      const settings = await updateDashboardAutomationSettings(input);
      setDashboardAutomations((current) =>
        current
          ? {
              ...current,
              settings
            }
          : current
      );
      await refreshDashboardData();
    } catch (error) {
      console.error(error);
      setDashboardError(toErrorMessage(error));
    }
  }

  return (
    <RivSidepanel
      activeSurface={activeSurface}
      activeThreadId={thread?.id ?? null}
      dashboardAutomations={dashboardAutomations}
      dashboardError={dashboardError}
      dashboardOverview={dashboardOverview}
      integrationStatus={integrationStatus}
      isDashboardLoading={isDashboardLoading}
      onChangeSurface={setActiveSurface}
      onConnectGoogle={handleConnectGoogle}
      onCreateChat={handleCreateChat}
      onDeleteThread={handleDeleteThread}
      onDisconnectGoogle={handleDisconnectGoogle}
      onDismissDashboardSuggestion={handleDismissDashboardSuggestion}
      onSaveWorkflowSettings={handleSaveWorkflowSettings}
      onSelectThread={handleSelectThread}
      threadTitle={thread?.title || pageContext?.title || 'Riva'}
      isSending={isSending}
      messages={messages}
      onResolveProposal={handleResolveProposal}
      onSend={handleSend}
      pendingOperationLabel={pendingOperationLabel}
      pendingTasks={pendingTasks}
      preparedSelection={preparedSelection}
      proposals={proposals}
      threadSummaries={threadSummaries}
      threads={threads}
    />
  );
}
