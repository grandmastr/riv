import { startTransition, useLayoutEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import type {
  ActionProposal,
  ConversationMessage,
  ContextAttachment,
  SelectedTextContext
} from '@riv/contracts';

type ProposalDecision = 'confirm' | 'reject';

export type RivSidepanelProps = {
  threadTitle: string;
  messages: ConversationMessage[];
  proposals: ActionProposal[];
  preparedSelection: SelectedTextContext | null;
  isSending: boolean;
  onSend(content: string): void | Promise<void>;
  onResolveProposal(
    proposalId: string,
    decision: ProposalDecision
  ): void | Promise<void>;
};

function formatAttachmentLabels(
  role: ConversationMessage['role'],
  attachments: ContextAttachment[]
) {
  return attachments
    .flatMap((attachment) => {
      switch (attachment.kind) {
        case 'page':
          return ['page', attachment.snapshot.pageType];
        case 'selection':
          return ['selection'];
        case 'tabs':
          return ['tabs', `${attachment.tabs.length} tabs`];
        case 'tabGroups':
          return ['tab groups'];
        case 'actionResult':
          return ['action result', attachment.result.status];
      }
    })
    .filter(
      (label) => !(role === 'user' && (label === 'page' || label === 'form'))
    );
}

function formatTimestamp(value: string) {
  return new Date(value).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit'
  });
}

function formatRoleLabel(role: ConversationMessage['role']) {
  switch (role) {
    case 'assistant':
      return 'Riv';
    case 'user':
      return 'You';
    default:
      return role;
  }
}

function formatPreparedSelectionPreview(selection: SelectedTextContext) {
  if (selection.text.length <= 72) {
    return selection.text;
  }

  return `${selection.text.slice(0, 69).trimEnd()}...`;
}

function MessageContent(props: {
  role: ConversationMessage['role'];
  content: string;
}) {
  if (props.role === 'assistant') {
    return (
      <div className="riv-message-content riv-markdown">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>
          {props.content}
        </ReactMarkdown>
      </div>
    );
  }

  return <p className="riv-message-content">{props.content}</p>;
}

function SendIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      viewBox="0 0 20 20"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M4 10h9.75"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.7"
      />
      <path
        d="M10.75 4.5 16.25 10l-5.5 5.5"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.7"
      />
    </svg>
  );
}

function ThinkingIndicator() {
  return (
    <article className="riv-message riv-message-assistant riv-message-thinking">
      <div className="riv-message-surface">
        <div className="riv-thinking-row">
          <div aria-hidden="true" className="riv-thinking-dots">
            <span className="riv-thinking-dot" />
            <span className="riv-thinking-dot" />
            <span className="riv-thinking-dot" />
          </div>
          <span className="riv-thinking-label">Riv is thinking</span>
        </div>
      </div>
    </article>
  );
}

export function RivSidepanel(props: RivSidepanelProps) {
  const [composer, setComposer] = useState('');
  const transcriptRef = useRef<HTMLElement | null>(null);
  const isSendDisabled = props.isSending || composer.trim().length === 0;
  const latestMessage = props.messages.at(-1);
  const showThinkingIndicator =
    props.isSending && latestMessage?.role !== 'assistant';

  useLayoutEffect(() => {
    const transcript = transcriptRef.current;

    if (!transcript) {
      return;
    }

    transcript.scrollTop = transcript.scrollHeight;
  }, [props.messages, props.proposals]);

  async function handleSubmit() {
    const content = composer.trim();

    if (!content) {
      return;
    }

    startTransition(() => {
      setComposer('');
    });

    await props.onSend(content);
  }

  async function handleComposerKeyDown(
    event: React.KeyboardEvent<HTMLTextAreaElement>
  ) {
    if (event.key !== 'Enter') {
      return;
    }

    if (event.shiftKey) {
      return;
    }

    event.preventDefault();
    await handleSubmit();
  }

  return (
    <div className="riv-shell">
      <header className="riv-header">
        <div className="riv-header-row">
          <div className="riv-header-main">
            <div className="riv-brand">
              <span className="riv-brand-mark">Riv</span>
              <p className="riv-eyebrow">{props.threadTitle}</p>
            </div>
          </div>
        </div>
      </header>

      <div className="riv-transcript-frame">
        <main
          aria-live="polite"
          aria-relevant="additions text"
          className="riv-transcript"
          ref={transcriptRef}
          role="log"
        >
          {props.messages.length === 0 ? (
            <section className="riv-empty-state">
              <p className="riv-empty-kicker">Assistant ready</p>
              <p className="riv-empty-copy">
                Riv can read the active page and suggest browser actions, but it
                will always ask before changing anything.
              </p>
            </section>
          ) : null}

          {props.messages.map((message) => (
            <article
              className={`riv-message riv-message-${message.role}`}
              key={message.id}
            >
              <div className="riv-message-meta">
                <span className="riv-message-role">
                  {formatRoleLabel(message.role)}
                </span>
                <time>{formatTimestamp(message.createdAt)}</time>
              </div>
              <div className="riv-message-surface">
                <div className="riv-message-body">
                  <MessageContent
                    content={message.content}
                    role={message.role}
                  />

                  {message.attachments.length > 0 ? (
                    <div className="riv-provenance">
                      {formatAttachmentLabels(
                        message.role,
                        message.attachments
                      ).map((label, index) => (
                        <span
                          className="riv-chip"
                          key={`${message.id}-${label}-${index}`}
                        >
                          {label}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
            </article>
          ))}

          {showThinkingIndicator ? <ThinkingIndicator /> : null}

          {props.proposals.length > 0 ? (
            <section className="riv-proposals">
              <div className="riv-section-heading">
                <p className="riv-eyebrow">Review</p>
                <h2>Suggested actions</h2>
              </div>
              {props.proposals.map((proposal) => (
                <article className="riv-proposal-card" key={proposal.id}>
                  <div className="riv-proposal-header">
                    <div>
                      <p className="riv-eyebrow">Needs confirmation</p>
                      <h3>{proposal.preview.title}</h3>
                    </div>
                    <span className={`riv-risk riv-risk-${proposal.riskLevel}`}>
                      {proposal.riskLevel}
                    </span>
                  </div>

                  <p>{proposal.preview.summary}</p>
                  <ul>
                    {proposal.preview.items.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>

                  <div className="riv-proposal-actions">
                    <button
                      className="riv-button riv-button-primary"
                      onClick={() =>
                        props.onResolveProposal(proposal.id, 'confirm')
                      }
                      type="button"
                    >
                      Confirm
                    </button>
                    <button
                      className="riv-button riv-button-secondary"
                      onClick={() =>
                        props.onResolveProposal(proposal.id, 'reject')
                      }
                      type="button"
                    >
                      Reject
                    </button>
                  </div>
                </article>
              ))}
            </section>
          ) : null}
        </main>
        <div
          aria-hidden="true"
          className="riv-scroll-aura riv-scroll-aura-top"
        />
        <div
          aria-hidden="true"
          className="riv-scroll-aura riv-scroll-aura-bottom"
        />
      </div>

      <footer className="riv-composer">
        <div className="riv-composer-shell">
          {props.preparedSelection ? (
            <div className="riv-prepared-selection-chip">
              <span className="riv-prepared-selection-label">selection</span>
              <span
                className="riv-prepared-selection-preview"
                title={props.preparedSelection.text}
              >
                {formatPreparedSelectionPreview(props.preparedSelection)}
              </span>
            </div>
          ) : null}
          <div className="riv-composer-field">
            <textarea
              aria-label="Message Riv"
              aria-keyshortcuts="Enter Shift+Enter"
              onChange={(event) => setComposer(event.target.value)}
              onKeyDown={(event) => void handleComposerKeyDown(event)}
              placeholder="Ask Riv about this page..."
              rows={2}
              value={composer}
            />
            <button
              aria-label={props.isSending ? 'Sending message' : 'Send message'}
              className="riv-button riv-button-primary riv-composer-send"
              data-state={
                props.isSending ? 'busy' : isSendDisabled ? 'disabled' : 'ready'
              }
              disabled={isSendDisabled}
              onClick={() => void handleSubmit()}
              type="button"
            >
              <SendIcon />
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
}
