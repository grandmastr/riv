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
  PageContextSnapshot,
  SelectedTextContext
} from '@riv/contracts';

import {
  sendStatelessTurn
} from '../../src/lib/api-client';
import { handleSidePanelShortcutKeydown } from '../../src/content/shortcut-handler';
import { getConversationStore } from '../../src/lib/local-conversation-store';
import {
  requestSidePanelToggle,
  type RivBackgroundResponse,
  sendBackgroundMessage,
  subscribeToPreparedSelection
} from '../../src/lib/messages';
import { RivSidepanel } from '../../src/sidepanel/panel';

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

function toErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return 'Riv hit an unexpected error.';
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
    return await sendBackgroundMessage<T>(request);
  } catch (error) {
    console.error(error);
    return null;
  }
}

export default function App() {
  const conversationStore = getConversationStore();
  const [thread, setThread] = useState<ConversationThread | null>(null);
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

  useEffect(() => {
    void (async () => {
      const [snapshot, selection, localDetail] = await Promise.all([
        readBackgroundMessageOrNull<PageContextSnapshot>({
          type: 'riv/read-active-page'
        }),
        readBackgroundMessageOrNull<SelectedTextContext | null>({
          type: 'riv/read-selection'
        }),
        conversationStore.getLatestThreadDetail()
      ]);

      if (snapshot) {
        setPageContext(snapshot);
      }

      setPreparedSelection((current) => current ?? selection);

      if (localDetail) {
        setThread(localDetail.thread);
        setMessages(localDetail.messages);
        setProposals(localDetail.proposals);
      }
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

    const created = createLocalThread(pageContext?.title || 'Riv session');
    await conversationStore.upsertThread(created);
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
    setThread((current) =>
      current?.id === nextThread.id ? nextThread : current
    );
    return nextThread;
  }

  async function collectAttachments(
    content: string,
    recentMessages: ConversationMessage[]
  ) {
    const attachments: ContextAttachment[] = [];
    const shouldIncludeTabContext = isTabManagementRequest(
      content,
      recentMessages
    );
    const shouldIncludePageContext = !shouldIncludeTabContext;
    const shouldIncludeSelection = !shouldIncludeTabContext;
    const [latestPageContext, selection, tabs, tabGroups] = await Promise.all([
      shouldIncludePageContext
        ? readBackgroundMessageOrNull<PageContextSnapshot>({
            type: 'riv/read-active-page'
          })
        : Promise.resolve(null),
      shouldIncludeSelection
        ? readBackgroundMessageOrNull<SelectedTextContext | null>({
            type: 'riv/read-selection'
          })
        : Promise.resolve(null),
      shouldIncludeTabContext
        ? readBackgroundMessageOrNull<BrowserTabSummary[]>({
            type: 'riv/list-tabs'
          })
        : Promise.resolve(null),
      shouldIncludeTabContext
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
    setPendingOperationLabel('Preparing response...');

    let activeThread: ConversationThread | null = null;
    let surfacedStreamError = false;

    try {
      activeThread = await ensureThread();
      const localDetail = await conversationStore.getThreadDetail(activeThread.id);
      const priorMessages = localDetail?.messages ?? messages;
      const recentMessages = priorMessages.slice(-6);
      const attachments = await collectAttachments(content, recentMessages);
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

      const assistantMessageId = `local-assistant-${Date.now()}`;
      const assistantCreatedAt = new Date().toISOString();
      let assistantContent = '';

      for await (const envelope of sendStatelessTurn({
        thread: activeThread,
        messages: recentMessages,
        content,
        attachments
      })) {
        switch (envelope.payload.type) {
          case 'message_delta': {
            const { delta } = envelope.payload;
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
            setPendingOperationLabel(
              formatOperationLabel(envelope.payload.invocation.tool)
            );
            break;
          }
          case 'tool_finished': {
            setPendingOperationLabel('Preparing response...');
            break;
          }
          case 'proposal_created': {
            const { proposal } = envelope.payload;

            setProposals((current) => upsertById(current, proposal));
            await conversationStore.upsertProposal(proposal);
            activeThread = await touchThread(activeThread, proposal.createdAt);
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
                content: `Riv couldn't complete that request: ${envelope.payload.message}`
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
          content: `Riv couldn't complete that request: ${toErrorMessage(error)}`
        });

        setMessages((current) => [...current, errorMessage]);
        await conversationStore.upsertMessage(errorMessage);
        await touchThread(activeThread, errorMessage.createdAt);
      }
    } finally {
      setIsSending(false);
      setPendingOperationLabel(null);
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
        throw new Error('Riv could not resolve that suggestion. Please try again.');
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
      await conversationStore.removeProposal(activeThread.id, proposalId);
      await conversationStore.upsertMessage(actionMessage);
      activeThread = await touchThread(activeThread, actionMessage.createdAt);
    } catch (error) {
      console.error(error);
      const errorMessage = createLocalMessage({
        id: `local-error-${Date.now()}`,
        threadId: activeThread.id,
        role: 'assistant',
        content: `Riv couldn't ${decision} that suggestion: ${toErrorMessage(error)}`
      });

      setMessages((current) => [...current, errorMessage]);
      await conversationStore.upsertMessage(errorMessage);
      await touchThread(activeThread, errorMessage.createdAt);
    }
  }

  return (
    <RivSidepanel
      threadTitle={thread?.title || pageContext?.title || 'Riv'}
      isSending={isSending}
      messages={messages}
      onResolveProposal={handleResolveProposal}
      onSend={handleSend}
      pendingOperationLabel={pendingOperationLabel}
      preparedSelection={preparedSelection}
      proposals={proposals}
    />
  );
}
