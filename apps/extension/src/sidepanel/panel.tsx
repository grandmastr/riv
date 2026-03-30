import {
  startTransition,
  type CSSProperties,
  useEffect,
  useLayoutEffect,
  useRef,
  useState
} from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import type {
  ActionProposal,
  DashboardAutomationsResponse,
  DashboardOverviewResponse,
  ConversationMessage,
  ConversationThread,
  GoogleIntegrationStatus,
  SelectedTextContext
} from '@riv/contracts';

type ProposalDecision = 'confirm' | 'reject';
type SurfaceMotionDirection = 'idle' | 'forward' | 'backward';

export type PendingTaskItem = {
  proposalId: string;
  threadId: string;
  title: string;
  summary: string;
  riskLevel: ActionProposal['riskLevel'];
  createdAt: string;
};

export type RivSurfaceTab = 'assistant' | 'workflow';

export type RivSidepanelProps = {
  threadTitle: string;
  messages: ConversationMessage[];
  proposals: ActionProposal[];
  threads?: ConversationThread[];
  threadSummaries?: Record<string, string>;
  activeThreadId?: string | null;
  pendingTasks?: PendingTaskItem[];
  preparedSelection: SelectedTextContext | null;
  isSending: boolean;
  pendingOperationLabel?: string | null;
  activeSurface?: RivSurfaceTab;
  onChangeSurface?(surface: RivSurfaceTab): void | Promise<void>;
  integrationStatus?: GoogleIntegrationStatus | null;
  dashboardOverview?: DashboardOverviewResponse | null;
  dashboardAutomations?: DashboardAutomationsResponse | null;
  isDashboardLoading?: boolean;
  dashboardError?: string | null;
  onConnectGoogle?(): void | Promise<void>;
  onDisconnectGoogle?(): void | Promise<void>;
  onDismissDashboardSuggestion?(suggestionId: string): void | Promise<void>;
  onSaveWorkflowSettings?(input: {
    meetingReminderOffsetsMinutes: number[];
  }): void | Promise<void>;
  onSend(content: string): void | Promise<void>;
  onCreateChat?(): void | Promise<void>;
  onSelectThread?(threadId: string): void | Promise<void>;
  onDeleteThread?(threadId: string): void | Promise<void>;
  onResolveProposal(
    proposalId: string,
    decision: ProposalDecision
  ): void | Promise<void>;
};

function parseOffsetsInput(value: string) {
  const values = value
    .split(',')
    .map((part) => Number.parseInt(part.trim(), 10))
    .filter((part) => Number.isFinite(part) && part > 0);

  return [...new Set(values)];
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
      return 'Riva';
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

function normalizeComposerCapitalization(value: string) {
  return value.replace(/(^|[.!?]\s+|\n+)([a-z])/g, (match, prefix, letter) => {
    return `${prefix}${String(letter).toUpperCase()}`;
  });
}

const MIN_COMPOSER_HEIGHT_PX = 54;
const MAX_COMPOSER_HEIGHT_PX = 168;

function toSurfaceOrderIndex(surface: RivSurfaceTab) {
  return surface === 'assistant' ? 0 : 1;
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

function NewChatIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      viewBox="0 0 20 20"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M10 5.25v9.5"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.6"
      />
      <path
        d="M5.25 10h9.5"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.6"
      />
    </svg>
  );
}

function ChatsIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      viewBox="0 0 20 20"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M4.5 5.25h11"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.6"
      />
      <path
        d="M4.5 10h11"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.6"
      />
      <path
        d="M4.5 14.75h8"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.6"
      />
    </svg>
  );
}

function DeleteThreadIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      viewBox="0 0 20 20"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M6.25 6.25h7.5"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.75"
      />
      <path
        d="M7.25 6.25v7.5a1 1 0 0 0 1 1h3.5a1 1 0 0 0 1-1v-7.5"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.75"
      />
      <path
        d="M8.5 6.25V5.5a1 1 0 0 1 1-1h1a1 1 0 0 1 1 1v.75"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.75"
      />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      viewBox="0 0 20 20"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M10 6.35a3.65 3.65 0 1 0 0 7.3 3.65 3.65 0 0 0 0-7.3Z"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2.5"
      />
      <path
        d="M10 2.1v2.15M10 15.75v2.15M4.24 4.24l1.52 1.52M14.24 14.24l1.52 1.52M2.1 10h2.15M15.75 10h2.15M4.24 15.76l1.52-1.52M14.24 5.76l1.52-1.52"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2.55"
      />
    </svg>
  );
}

function ThinkingIndicator(props: { label: string }) {
  return (
    <article className="riv-message riv-message-assistant riv-message-thinking">
      <div className="riv-message-surface">
        <div className="riv-thinking-row">
          <div aria-hidden="true" className="riv-thinking-dots">
            <span className="riv-thinking-dot" />
            <span className="riv-thinking-dot" />
            <span className="riv-thinking-dot" />
          </div>
          <span className="riv-thinking-label">{props.label}</span>
        </div>
      </div>
    </article>
  );
}

export function RivSidepanel(props: RivSidepanelProps) {
  const [composer, setComposer] = useState('');
  const [isThreadListOpen, setIsThreadListOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [workflowOffsetsInput, setWorkflowOffsetsInput] = useState('');
  const transcriptRef = useRef<HTMLElement | null>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const surfaceNavRef = useRef<HTMLElement | null>(null);
  const assistantTabRef = useRef<HTMLButtonElement | null>(null);
  const workflowTabRef = useRef<HTMLButtonElement | null>(null);
  const previousSurfaceRef = useRef<RivSurfaceTab>(
    props.activeSurface ?? 'assistant'
  );
  const [surfaceMotionDirection, setSurfaceMotionDirection] =
    useState<SurfaceMotionDirection>('idle');
  const [surfacePillMetrics, setSurfacePillMetrics] = useState({
    x: 0,
    width: 0
  });
  const activeSurface = props.activeSurface ?? 'assistant';
  const threads = props.threads ?? [];
  const pendingTasks = props.pendingTasks ?? [];
  const pendingTasksByThread = new Map<string, number>();
  pendingTasks.forEach((task) => {
    pendingTasksByThread.set(
      task.threadId,
      (pendingTasksByThread.get(task.threadId) ?? 0) + 1
    );
  });
  const isSendDisabled = props.isSending || composer.trim().length === 0;
  const latestMessage = props.messages.at(-1);
  const showThinkingIndicator = props.isSending;
  const totalPendingTasks = pendingTasks.length;
  const dashboardOverview = props.dashboardOverview;
  const dashboardAutomations = props.dashboardAutomations;
  const integrationStatus = props.integrationStatus;

  useLayoutEffect(() => {
    const transcript = transcriptRef.current;

    if (!transcript) {
      return;
    }

    transcript.scrollTop = transcript.scrollHeight;
  }, [props.messages, props.proposals]);

  useLayoutEffect(() => {
    const composerElement = composerRef.current;

    if (!composerElement) {
      return;
    }

    // Keep empty composer stable: placeholder/layout timing can inflate
    // scrollHeight on mount, which makes the input look permanently too tall.
    if (composer.length === 0) {
      composerElement.style.height = `${MIN_COMPOSER_HEIGHT_PX}px`;
      composerElement.style.overflowY = 'hidden';
      return;
    }

    composerElement.style.height = 'auto';
    const scrollHeight = composerElement.scrollHeight;
    const nextHeight = Math.min(
      Math.max(scrollHeight, MIN_COMPOSER_HEIGHT_PX),
      MAX_COMPOSER_HEIGHT_PX
    );
    composerElement.style.height = `${nextHeight}px`;
    composerElement.style.overflowY =
      scrollHeight > MAX_COMPOSER_HEIGHT_PX ? 'auto' : 'hidden';
  }, [composer]);

  useLayoutEffect(() => {
    const readActiveButton = () =>
      activeSurface === 'assistant'
        ? assistantTabRef.current
        : workflowTabRef.current;

    const syncSurfacePill = () => {
      const activeButton = readActiveButton();

      if (!activeButton) {
        return;
      }

      const nextX = activeButton.offsetLeft;
      const nextWidth = activeButton.offsetWidth;
      setSurfacePillMetrics((current) =>
        current.x === nextX && current.width === nextWidth
          ? current
          : {
              x: nextX,
              width: nextWidth
            }
      );
    };

    syncSurfacePill();

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', syncSurfacePill);
      return () => {
        window.removeEventListener('resize', syncSurfacePill);
      };
    }

    const observer = new ResizeObserver(() => {
      syncSurfacePill();
    });

    if (surfaceNavRef.current) {
      observer.observe(surfaceNavRef.current);
    }
    if (assistantTabRef.current) {
      observer.observe(assistantTabRef.current);
    }
    if (workflowTabRef.current) {
      observer.observe(workflowTabRef.current);
    }

    return () => {
      observer.disconnect();
    };
  }, [activeSurface]);

  useEffect(() => {
    const previousSurface = previousSurfaceRef.current;

    if (previousSurface === activeSurface) {
      return;
    }

    const nextDirection: SurfaceMotionDirection =
      toSurfaceOrderIndex(activeSurface) > toSurfaceOrderIndex(previousSurface)
        ? 'forward'
        : 'backward';

    setSurfaceMotionDirection(nextDirection);
    previousSurfaceRef.current = activeSurface;

    const timeoutId = window.setTimeout(() => {
      setSurfaceMotionDirection('idle');
    }, 230);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [activeSurface]);

  useEffect(() => {
    if (!isThreadListOpen) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsThreadListOpen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isThreadListOpen]);

  useEffect(() => {
    if (threads.length === 0 && isThreadListOpen) {
      setIsThreadListOpen(false);
    }
  }, [isThreadListOpen, threads.length]);

  useEffect(() => {
    if (!isSettingsOpen) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsSettingsOpen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isSettingsOpen]);

  useEffect(() => {
    if (!dashboardAutomations) {
      setWorkflowOffsetsInput('');
      return;
    }

    setWorkflowOffsetsInput(
      dashboardAutomations.settings.meetingReminderOffsetsMinutes.join(', ')
    );
  }, [dashboardAutomations]);

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

  function handleSelectThread(threadId: string) {
    setIsThreadListOpen(false);
    void props.onSelectThread?.(threadId);
  }

  const surfacePillStyle = {
    '--riv-surface-pill-x': `${surfacePillMetrics.x}px`,
    '--riv-surface-pill-width': `${surfacePillMetrics.width}px`
  } as CSSProperties;

  async function handleSaveWorkflowSettings() {
    const offsets = parseOffsetsInput(workflowOffsetsInput);

    if (offsets.length === 0) {
      return;
    }

    await props.onSaveWorkflowSettings?.({
      meetingReminderOffsetsMinutes: offsets
    });
  }

  return (
    <div className="riv-shell">
      <header className="riv-header">
        <div className="riv-header-row">
          <div className="riv-header-main">
            <div className="riv-brand">
              <span className="riv-brand-mark">Riva</span>
              <p className="riv-eyebrow">{props.threadTitle}</p>
            </div>
          </div>
          <div className="riv-header-actions">
            {threads.length > 0 ? (
              <button
                aria-controls="riv-thread-overlay"
                aria-expanded={isThreadListOpen}
                aria-haspopup="dialog"
                aria-label="Open chats"
                className="riv-button riv-button-secondary riv-header-open-chats riv-header-icon-button"
                data-title="Chats"
                data-state={isThreadListOpen ? 'open' : 'closed'}
                disabled={props.isSending}
                onClick={() => setIsThreadListOpen((open) => !open)}
                title="Chats"
                type="button"
              >
                <ChatsIcon />
                {totalPendingTasks > 0 ? (
                  <span className="riv-thread-menu-trigger-count">
                    {totalPendingTasks}
                  </span>
                ) : null}
              </button>
            ) : null}

            <button
              aria-label="New chat"
              className="riv-button riv-button-secondary riv-header-create-chat riv-header-icon-button"
              data-title="New chat"
              disabled={props.isSending}
              onClick={() => void props.onCreateChat?.()}
              title="New chat"
              type="button"
            >
              <NewChatIcon />
            </button>

            <button
              aria-expanded={isSettingsOpen}
              aria-haspopup="dialog"
              aria-label="Open settings"
              className="riv-button riv-button-secondary riv-header-open-settings riv-header-icon-button"
              data-title="Settings"
              onClick={() => setIsSettingsOpen((open) => !open)}
              title="Settings"
              type="button"
            >
              <SettingsIcon />
            </button>
          </div>
        </div>

        <nav
          aria-label="Workspace sections"
          className="riv-surface-nav"
          data-motion={surfaceMotionDirection}
          data-pill-ready={surfacePillMetrics.width > 0 ? 'true' : 'false'}
          ref={surfaceNavRef}
          style={surfacePillStyle}
        >
          <span aria-hidden="true" className="riv-surface-pill" />
          <button
            className="riv-surface-tab"
            data-state={activeSurface === 'assistant' ? 'active' : 'idle'}
            onClick={() => void props.onChangeSurface?.('assistant')}
            ref={assistantTabRef}
            type="button"
          >
            <span className="riv-surface-tab-label">Assistant</span>
          </button>
          <button
            className="riv-surface-tab"
            data-state={activeSurface === 'workflow' ? 'active' : 'idle'}
            onClick={() => void props.onChangeSurface?.('workflow')}
            ref={workflowTabRef}
            type="button"
          >
            <span className="riv-surface-tab-label">Workflow</span>
          </button>
        </nav>

        

      </header>

      {isThreadListOpen ? (
        <section
          aria-label="Chats"
          aria-modal="true"
          className="riv-thread-overlay"
          id="riv-thread-overlay"
          role="dialog"
        >
          <div className="riv-thread-overlay-header">
            <div className="riv-section-heading riv-section-heading-inline">
              <p className="riv-eyebrow">Chats</p>
            </div>
            <button
              aria-label="Close chats"
              className="riv-button riv-button-secondary riv-thread-overlay-close"
              onClick={() => setIsThreadListOpen(false)}
              type="button"
            >
              Close
            </button>
          </div>
          <div className="riv-thread-overlay-list">
            {threads.map((thread) => {
              const taskCount = pendingTasksByThread.get(thread.id) ?? 0;
              const isActive = thread.id === props.activeThreadId;
              const summary = props.threadSummaries?.[thread.id];
              return (
                <article
                  className="riv-thread-overlay-item"
                  data-state={isActive ? 'active' : 'idle'}
                  key={thread.id}
                >
                  <button
                    className="riv-thread-overlay-select"
                    disabled={props.isSending}
                    onClick={() => handleSelectThread(thread.id)}
                    type="button"
                  >
                    <span className="riv-thread-overlay-item-title">
                      {thread.title}
                    </span>
                    {summary ? (
                      <span className="riv-thread-overlay-item-summary">
                        {summary}
                      </span>
                    ) : null}
                  </button>
                  <div className="riv-thread-overlay-item-actions">
                    {taskCount > 0 ? (
                      <span className="riv-thread-overlay-item-count">
                        {taskCount}
                      </span>
                    ) : null}
                    <button
                      aria-label={`Delete ${thread.title}`}
                      className="riv-button riv-thread-overlay-delete"
                      disabled={props.isSending}
                      onClick={() => void props.onDeleteThread?.(thread.id)}
                      type="button"
                    >
                      <DeleteThreadIcon />
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      ) : null}

      {isSettingsOpen ? (
        <section
          aria-label="Settings"
          aria-modal="true"
          className="riv-thread-overlay riv-settings-overlay"
          id="riv-settings-overlay"
          role="dialog"
        >
          <div className="riv-thread-overlay-header">
            <div className="riv-section-heading riv-section-heading-inline">
              <p className="riv-eyebrow">Settings</p>
            </div>
            <button
              aria-label="Close settings"
              className="riv-button riv-button-secondary riv-thread-overlay-close"
              onClick={() => setIsSettingsOpen(false)}
              type="button"
            >
              Close
            </button>
          </div>

          <div className="riv-settings-overlay-body">
            <div className="riv-dashboard-section">
              <div className="riv-section-heading">
                <p className="riv-eyebrow">Connections</p>
              </div>
              <div className="riv-dashboard-list">
                <article className="riv-dashboard-card">
                  <h3>Google Calendar</h3>
                  <p className="riv-dashboard-muted">
                    {integrationStatus?.calendarConnected
                      ? 'Connected'
                      : 'Not connected'}
                  </p>
                </article>
                <article className="riv-dashboard-card">
                  <h3>Gmail</h3>
                  <p className="riv-dashboard-muted">
                    {integrationStatus?.gmailConnected ? 'Connected' : 'Not connected'}
                  </p>
                </article>
              </div>
              <div className="riv-dashboard-actions">
                <button
                  aria-label={
                    integrationStatus?.status === 'connected'
                      ? 'Reconnect Google'
                      : 'Connect Google'
                  }
                  className="riv-button riv-button-primary"
                  onClick={() => void props.onConnectGoogle?.()}
                  type="button"
                >
                  {integrationStatus?.status === 'connected'
                    ? 'Reconnect Google'
                    : 'Connect Google'}
                </button>
                {integrationStatus?.status === 'connected' ? (
                  <button
                    aria-label="Disconnect Google"
                    className="riv-button riv-button-secondary"
                    onClick={() => void props.onDisconnectGoogle?.()}
                    type="button"
                  >
                    Disconnect Google
                  </button>
                ) : null}
              </div>
            </div>
          </div>
        </section>
      ) : null}

      {activeSurface === 'assistant' ? (
        <>
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
                    Riva can read the active page and suggest browser actions, but it
                    will always ask before changing anything.
                  </p>
                </section>
              ) : null}

              {props.messages.map((message) => {
                return (
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
                      </div>
                    </div>
                  </article>
                );
              })}

              {showThinkingIndicator ? (
                <ThinkingIndicator
                  label={props.pendingOperationLabel ?? 'Working...'}
                />
              ) : null}

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
                  autoCapitalize="sentences"
                  aria-label="Message Riva"
                  aria-keyshortcuts="Enter Shift+Enter"
                  ref={composerRef}
                  onChange={(event) =>
                    setComposer(
                      normalizeComposerCapitalization(event.target.value)
                    )
                  }
                  onKeyDown={(event) => void handleComposerKeyDown(event)}
                  placeholder="Ask Riva about this page..."
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
        </>
      ) : (
        <main className="riv-dashboard" role="region">
          {props.isDashboardLoading ? (
            <p className="riv-dashboard-muted">Loading dashboard...</p>
          ) : null}
          {props.dashboardError ? (
            <p className="riv-dashboard-error">{props.dashboardError}</p>
          ) : null}

          {!props.isDashboardLoading && !props.dashboardError && activeSurface === 'workflow' ? (
            <section className="riv-dashboard-section">
              <div className="riv-section-heading">
                <p className="riv-eyebrow">Workflow automations</p>
              </div>
              <div className="riv-dashboard-list">
                {(dashboardAutomations?.automations ?? []).map((automation) => (
                  <article className="riv-dashboard-card" key={automation.key}>
                    <h3>{automation.name}</h3>
                    <p className="riv-dashboard-muted">
                      Status: {automation.status}
                    </p>
                  </article>
                ))}
              </div>

              <div className="riv-section-heading">
                <p className="riv-eyebrow">Upcoming meetings</p>
              </div>
              {(dashboardOverview?.meetings ?? []).length > 0 ? (
                <div className="riv-dashboard-list">
                  {(dashboardOverview?.meetings ?? []).map((meeting) => (
                    <article className="riv-dashboard-card" key={meeting.id}>
                      <h3>{meeting.title}</h3>
                      <p className="riv-dashboard-muted">
                        {formatTimestamp(meeting.startAt)}
                      </p>
                    </article>
                  ))}
                </div>
              ) : (
                <p className="riv-dashboard-muted">No meetings found.</p>
              )}

              <div className="riv-section-heading">
                <p className="riv-eyebrow">Suggested Gmail replies</p>
              </div>
              {(dashboardOverview?.gmailSuggestions ?? []).length > 0 ? (
                <div className="riv-dashboard-list">
                  {(dashboardOverview?.gmailSuggestions ?? []).map((suggestion) => (
                    <article className="riv-dashboard-card" key={suggestion.id}>
                      <h3>{suggestion.subject}</h3>
                      <p>{suggestion.suggestion}</p>
                      <div className="riv-dashboard-actions">
                        <button
                          aria-label="Dismiss suggestion"
                          className="riv-button riv-button-secondary"
                          onClick={() =>
                            void props.onDismissDashboardSuggestion?.(suggestion.id)
                          }
                          type="button"
                        >
                          Dismiss suggestion
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <p className="riv-dashboard-muted">No pending suggestions.</p>
              )}

              <form
                className="riv-dashboard-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  void handleSaveWorkflowSettings();
                }}
              >
                <label className="riv-dashboard-label" htmlFor="riv-workflow-offsets">
                  Reminder offsets (minutes)
                </label>
                <input
                  className="riv-dashboard-input"
                  id="riv-workflow-offsets"
                  onChange={(event) => setWorkflowOffsetsInput(event.target.value)}
                  type="text"
                  value={workflowOffsetsInput}
                />
                <button
                  aria-label="Save workflow settings"
                  className="riv-button riv-button-primary"
                  type="submit"
                >
                  Save workflow settings
                </button>
              </form>
            </section>
          ) : null}

        </main>
      )}
    </div>
  );
}
