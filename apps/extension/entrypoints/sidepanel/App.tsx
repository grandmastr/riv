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

export default function App() {
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
        const [snapshot, selection] = await Promise.all([
          sendBackgroundMessage<PageContextSnapshot>({
            type: 'riv/read-active-page'
          }),
          sendBackgroundMessage<SelectedTextContext | null>({
            type: 'riv/read-selection'
          })
        ]);

        setPageContext(snapshot);
        setPreparedSelection((current) => current ?? selection);
      } catch (error) {
        console.error(error);
      }
    })();
  }, []);

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
    setThread(created);
    return created;
  }

  async function collectAttachments() {
    const attachments: ContextAttachment[] = [];

    if (pageContext) {
      attachments.push({
        kind: 'page',
        snapshot: pageContext
      });
    }

    const selection =
      preparedSelection ??
      (await sendBackgroundMessage<SelectedTextContext | null>({
        type: 'riv/read-selection'
      }));

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
      const activeThread = await ensureThread();
      const attachments = await collectAttachments();

      setMessages((current) => [
        ...current,
        createLocalMessage({
          id: `local-user-${Date.now()}`,
          threadId: activeThread.id,
          role: 'user',
          content,
          attachments
        })
      ]);

      const assistantMessageId = `local-assistant-${Date.now()}`;
      const assistantCreatedAt = new Date().toISOString();
      const nextProposals: ActionProposal[] = [];

      for await (const envelope of sendMessage(
        activeThread.id,
        content,
        attachments
      )) {
        switch (envelope.payload.type) {
          case 'message_delta': {
            const { delta } = envelope.payload;

            setMessages((current) => {
              const existingIndex = current.findIndex(
                (message) => message.id === assistantMessageId
              );

              if (existingIndex < 0) {
                return [
                  ...current,
                  createLocalMessage({
                    id: assistantMessageId,
                    threadId: activeThread.id,
                    role: 'assistant',
                    content: delta,
                    createdAt: assistantCreatedAt
                  })
                ];
              }

              const nextMessages = [...current];
              const existingMessage = nextMessages[existingIndex];

              if (!existingMessage) {
                return current;
              }

              nextMessages[existingIndex] = {
                ...existingMessage,
                content: `${existingMessage.content}${delta}`
              };

              return nextMessages;
            });
            break;
          }
          case 'proposal_created': {
            const { proposal } = envelope.payload;

            nextProposals.push(proposal);
            setProposals((current) => [...current, proposal]);
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
    const activeThread = await ensureThread();
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

      await resolveProposal(activeThread.id, proposal, decision);
      setMessages((current) => [
        ...current,
        createLocalMessage({
          id: `local-action-${Date.now()}`,
          threadId: activeThread.id,
          role: 'assistant',
          content: result.summary,
          attachments: [createActionResultAttachment(result)]
        })
      ]);
      setProposals((current) =>
        current.filter((item) => item.id !== proposalId)
      );
    } catch (error) {
      console.error(error);
    }
  }

  return (
    <RivSidepanel
      threadTitle={pageContext?.title || 'Riv'}
      isSending={isSending}
      messages={messages}
      onResolveProposal={handleResolveProposal}
      onSend={handleSend}
      preparedSelection={preparedSelection}
      proposals={proposals}
    />
  );
}
