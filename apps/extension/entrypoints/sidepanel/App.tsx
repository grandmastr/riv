import { useEffect, useState } from 'react';

import type {
  ActionConfirmation,
  ActionExecutionResult,
  ActionProposal,
  ContextAttachment,
  ConversationMessage,
  ConversationThread,
  PageContextSnapshot,
  SelectedTextContext
} from '@riv/contracts';

import {
  createThread,
  resolveProposal,
  sendMessage
} from '../../src/lib/api-client';
import { getConversationStore } from '../../src/lib/local-conversation-store';
import {
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

function upsertById<T extends { id: string }>(items: T[], nextItem: T) {
  const index = items.findIndex((item) => item.id === nextItem.id);

  if (index < 0) {
    return [...items, nextItem];
  }

  const nextItems = [...items];
  nextItems[index] = nextItem;
  return nextItems;
}

function stripTransientAttachments(attachments: ContextAttachment[]) {
  return attachments.filter(
    (attachment) =>
      attachment.kind !== 'page' && attachment.kind !== 'selection'
  );
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

  useEffect(() => {
    void (async () => {
      try {
        const [snapshot, selection, localDetail] = await Promise.all([
          sendBackgroundMessage<PageContextSnapshot>({
            type: 'riv/read-active-page'
          }),
          sendBackgroundMessage<SelectedTextContext | null>({
            type: 'riv/read-selection'
          }),
          conversationStore.getLatestThreadDetail()
        ]);

        setPageContext(snapshot);
        setPreparedSelection((current) => current ?? selection);

        if (localDetail) {
          setThread(localDetail.thread);
          setMessages(localDetail.messages);
          setProposals(localDetail.proposals);
        }
      } catch (error) {
        console.error(error);
      }
    })();
  }, [conversationStore]);

  useEffect(() => {
    return subscribeToPreparedSelection((selection) => {
      setPreparedSelection(selection);
    });
  }, []);

  async function ensureThread() {
    if (thread) {
      return thread;
    }

    const created = await createThread(pageContext?.title || 'Riv session');
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

  async function collectAttachments() {
    const attachments: ContextAttachment[] = [];
    const [latestPageContext, selection] = await Promise.all([
      sendBackgroundMessage<PageContextSnapshot>({
        type: 'riv/read-active-page'
      }),
      sendBackgroundMessage<SelectedTextContext | null>({
        type: 'riv/read-selection'
      })
    ]);

    setPageContext(latestPageContext);
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

    return attachments;
  }

  async function handleSend(content: string) {
    setIsSending(true);

    try {
      let activeThread = await ensureThread();
      const attachments = await collectAttachments();
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

      for await (const envelope of sendMessage(
        activeThread.id,
        content,
        attachments
      )) {
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
            await conversationStore.upsertMessage(assistantMessage);
            activeThread = await touchThread(activeThread, assistantCreatedAt);
            break;
          }
          case 'proposal_created': {
            const { proposal } = envelope.payload;

            setProposals((current) => upsertById(current, proposal));
            await conversationStore.upsertProposal(proposal);
            activeThread = await touchThread(activeThread, proposal.createdAt);
            await sendBackgroundMessage<ActionProposal>({
              type: 'riv/register-proposal',
              proposal
            });
            break;
          }
          case 'error':
            console.error(envelope.payload.message);
            break;
          default:
            break;
        }
      }
    } catch (error) {
      console.error(error);
    } finally {
      setIsSending(false);
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
      const result = await sendBackgroundMessage<ActionExecutionResult>({
        type: 'riv/confirm-proposal',
        confirmation
      });
      const actionMessage = createLocalMessage({
        id: `local-action-${Date.now()}`,
        threadId: activeThread.id,
        role: 'assistant',
        content: result.summary,
        attachments: [createActionResultAttachment(result)]
      });

      await resolveProposal(activeThread.id, proposal, decision);
      setMessages((current) => [...current, actionMessage]);
      setProposals((current) =>
        current.filter((item) => item.id !== proposalId)
      );
      await conversationStore.removeProposal(activeThread.id, proposalId);
      await conversationStore.upsertMessage(actionMessage);
      activeThread = await touchThread(activeThread, actionMessage.createdAt);
    } catch (error) {
      console.error(error);
    }
  }

  return (
    <RivSidepanel
      threadTitle={thread?.title || pageContext?.title || 'Riv'}
      isSending={isSending}
      messages={messages}
      onResolveProposal={handleResolveProposal}
      onSend={handleSend}
      preparedSelection={preparedSelection}
      proposals={proposals}
    />
  );
}
