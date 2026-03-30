import type {
  AutomationRunLog,
  AutomationSettings,
  AutomationSummary,
  DashboardAutomationsResponse,
  DashboardMeeting,
  DashboardOverviewResponse,
  GmailReplySuggestion,
  GoogleIntegrationStatus,
  MeetingReminder
} from '@riv/contracts';

type DashboardServiceOptions = {
  now?: () => string;
};

type UserDashboardState = {
  meetings: DashboardMeeting[];
  reminders: MeetingReminder[];
  gmailSuggestions: GmailReplySuggestion[];
  settings: AutomationSettings;
  runLogs: AutomationRunLog[];
};

type UpdateAutomationSettingsInput = Partial<AutomationSettings>;

export interface DashboardService {
  getGoogleIntegrationStatus(userId: string): Promise<GoogleIntegrationStatus>;
  connectGoogle(userId: string): Promise<GoogleIntegrationStatus>;
  disconnectGoogle(userId: string): Promise<GoogleIntegrationStatus>;
  getOverview(userId: string): Promise<DashboardOverviewResponse>;
  getAutomations(userId: string): Promise<DashboardAutomationsResponse>;
  updateAutomationSettings(
    userId: string,
    input: UpdateAutomationSettingsInput
  ): Promise<AutomationSettings>;
  dismissSuggestion(
    userId: string,
    suggestionId: string
  ): Promise<GmailReplySuggestion | null>;
}

const GOOGLE_SCOPES = ['calendar.readonly', 'gmail.readonly'];

const DEFAULT_AUTOMATION_SETTINGS: AutomationSettings = {
  meetingReminderOffsetsMinutes: [1440, 30],
  enabledMeetingReminders: true,
  enabledGmailSuggestions: true
};

function addMinutes(timestamp: string, minutes: number) {
  const date = new Date(timestamp);
  date.setMinutes(date.getMinutes() + minutes);
  return date.toISOString();
}

function subtractMinutes(timestamp: string, minutes: number) {
  const date = new Date(timestamp);
  date.setMinutes(date.getMinutes() - minutes);
  return date.toISOString();
}

function normalizeOffsets(input: number[]) {
  return [...new Set(input.filter((value) => Number.isFinite(value) && value > 0))]
    .map((value) => Math.floor(value))
    .sort((left, right) => right - left);
}

function latestLogAt(
  logs: AutomationRunLog[],
  automationKey: AutomationRunLog['automationKey']
) {
  return logs
    .filter((log) => log.automationKey === automationKey)
    .sort((left, right) => right.startedAt.localeCompare(left.startedAt))[0]
    ?.startedAt;
}

function updateReminderStatuses(
  reminders: MeetingReminder[],
  now: string
): MeetingReminder[] {
  return reminders.map(
    (reminder): MeetingReminder => ({
      ...reminder,
      status:
        reminder.status === 'dismissed'
          ? 'dismissed'
          : reminder.triggerAt <= now
            ? 'sent'
            : 'scheduled'
    })
  );
}

export function createInMemoryDashboardService(
  options: DashboardServiceOptions = {}
): DashboardService {
  const now = options.now ?? (() => new Date().toISOString());
  const integrationByUser = new Map<string, GoogleIntegrationStatus>();
  const stateByUser = new Map<string, UserDashboardState>();

  function integrationFor(userId: string): GoogleIntegrationStatus {
    return (
      integrationByUser.get(userId) ?? {
        provider: 'google',
        status: 'disconnected',
        calendarConnected: false,
        gmailConnected: false,
        scopes: []
      }
    );
  }

  function ensureState(userId: string): UserDashboardState {
    const existing = stateByUser.get(userId);

    if (existing) {
      return existing;
    }

    const created: UserDashboardState = {
      meetings: [],
      reminders: [],
      gmailSuggestions: [],
      settings: DEFAULT_AUTOMATION_SETTINGS,
      runLogs: []
    };
    stateByUser.set(userId, created);
    return created;
  }

  function addRunLog(
    state: UserDashboardState,
    input: Omit<AutomationRunLog, 'id'>
  ) {
    state.runLogs = [
      {
        id: `run_${crypto.randomUUID()}`,
        ...input
      },
      ...state.runLogs
    ].slice(0, 50);
  }

  function seedOverviewData(userId: string) {
    const state = ensureState(userId);

    if (state.meetings.length > 0) {
      return state;
    }

    const currentTime = now();
    const firstMeetingStart = addMinutes(currentTime, 30);
    const firstMeetingEnd = addMinutes(firstMeetingStart, 45);
    const secondMeetingStart = addMinutes(currentTime, 24 * 60 + 30);
    const secondMeetingEnd = addMinutes(secondMeetingStart, 30);

    state.meetings = [
      {
        id: 'meeting_next_sync',
        title: 'Weekly product sync',
        startAt: firstMeetingStart,
        endAt: firstMeetingEnd,
        attendees: ['alex@example.com', 'team@example.com'],
        source: 'google-calendar'
      },
      {
        id: 'meeting_customer_checkin',
        title: 'Customer check-in',
        startAt: secondMeetingStart,
        endAt: secondMeetingEnd,
        attendees: ['sam@example.com', 'pm@example.com'],
        source: 'google-calendar'
      }
    ];

    state.reminders = state.meetings.flatMap((meeting) =>
      state.settings.meetingReminderOffsetsMinutes.map((offsetMinutes) => ({
        id: `reminder_${meeting.id}_${offsetMinutes}`,
        meetingId: meeting.id,
        triggerAt: subtractMinutes(meeting.startAt, offsetMinutes),
        status: 'scheduled' as const
      }))
    );

    state.gmailSuggestions = [
      {
        id: 'suggestion_sync_agenda',
        meetingId: state.meetings[0]!.id,
        threadId: 'thread_sync_001',
        subject: 'Agenda for weekly product sync',
        suggestion:
          "Hi team, sharing a quick agenda for today's sync: timeline updates, open risks, and decisions needed.",
        status: 'new',
        matchSignals: ['participant-overlap', 'subject-similarity']
      }
    ];

    addRunLog(state, {
      automationKey: 'meeting-reminders',
      status: 'success',
      message: 'Scheduled reminders for upcoming meetings.',
      startedAt: currentTime,
      finishedAt: now()
    });
    addRunLog(state, {
      automationKey: 'gmail-reply-suggestions',
      status: 'success',
      message: 'Generated meeting-related Gmail reply suggestions.',
      startedAt: currentTime,
      finishedAt: now()
    });

    return state;
  }

  return {
    async getGoogleIntegrationStatus(userId) {
      return integrationFor(userId);
    },

    async connectGoogle(userId) {
      const connectedAt = now();
      const integration: GoogleIntegrationStatus = {
        provider: 'google',
        status: 'connected',
        calendarConnected: true,
        gmailConnected: true,
        connectedAt,
        scopes: GOOGLE_SCOPES
      };
      integrationByUser.set(userId, integration);
      seedOverviewData(userId);
      return integration;
    },

    async disconnectGoogle(userId) {
      const integration: GoogleIntegrationStatus = {
        provider: 'google',
        status: 'disconnected',
        calendarConnected: false,
        gmailConnected: false,
        scopes: []
      };
      integrationByUser.set(userId, integration);

      const state = ensureState(userId);
      state.meetings = [];
      state.reminders = [];
      state.gmailSuggestions = [];
      addRunLog(state, {
        automationKey: 'meeting-reminders',
        status: 'success',
        message: 'Disconnected Google integration and paused reminders.',
        startedAt: now(),
        finishedAt: now()
      });

      return integration;
    },

    async getOverview(userId) {
      const integration = integrationFor(userId);

      if (integration.status !== 'connected') {
        return {
          meetings: [],
          reminders: [],
          gmailSuggestions: []
        };
      }

      const state = seedOverviewData(userId);
      state.reminders = updateReminderStatuses(state.reminders, now());

      return {
        meetings: state.meetings,
        reminders: state.reminders,
        gmailSuggestions: state.gmailSuggestions
      };
    },

    async getAutomations(userId) {
      const integration = integrationFor(userId);
      const state = ensureState(userId);
      const currentTime = now();

      const automations: AutomationSummary[] = [
        {
          key: 'meeting-reminders',
          name: 'Meeting reminders',
          enabled:
            integration.status === 'connected' &&
            state.settings.enabledMeetingReminders,
          status: integration.status === 'connected' ? 'healthy' : 'degraded',
          lastRunAt: latestLogAt(state.runLogs, 'meeting-reminders'),
          nextRunAt: addMinutes(currentTime, 5)
        },
        {
          key: 'gmail-reply-suggestions',
          name: 'Gmail reply suggestions',
          enabled:
            integration.status === 'connected' &&
            state.settings.enabledGmailSuggestions,
          status: integration.status === 'connected' ? 'healthy' : 'degraded',
          lastRunAt: latestLogAt(state.runLogs, 'gmail-reply-suggestions'),
          nextRunAt: addMinutes(currentTime, 10)
        }
      ];

      return {
        automations,
        runLogs: state.runLogs,
        settings: state.settings
      };
    },

    async updateAutomationSettings(userId, input) {
      const state = ensureState(userId);

      state.settings = {
        ...state.settings,
        ...(Array.isArray(input.meetingReminderOffsetsMinutes)
          ? {
              meetingReminderOffsetsMinutes: normalizeOffsets(
                input.meetingReminderOffsetsMinutes
              )
            }
          : {}),
        ...(typeof input.enabledMeetingReminders === 'boolean'
          ? {
              enabledMeetingReminders: input.enabledMeetingReminders
            }
          : {}),
        ...(typeof input.enabledGmailSuggestions === 'boolean'
          ? {
              enabledGmailSuggestions: input.enabledGmailSuggestions
            }
          : {})
      };

      if (state.meetings.length > 0) {
        state.reminders = state.meetings.flatMap((meeting) =>
          state.settings.meetingReminderOffsetsMinutes.map((offsetMinutes) => ({
            id: `reminder_${meeting.id}_${offsetMinutes}`,
            meetingId: meeting.id,
            triggerAt: subtractMinutes(meeting.startAt, offsetMinutes),
            status: 'scheduled' as const
          }))
        );
      }

      addRunLog(state, {
        automationKey: 'meeting-reminders',
        status: 'success',
        message: 'Updated dashboard automation settings.',
        startedAt: now(),
        finishedAt: now()
      });

      return state.settings;
    },

    async dismissSuggestion(userId, suggestionId) {
      const state = ensureState(userId);
      const suggestion = state.gmailSuggestions.find((item) => item.id === suggestionId);

      if (!suggestion) {
        return null;
      }

      suggestion.status = 'dismissed';
      addRunLog(state, {
        automationKey: 'gmail-reply-suggestions',
        status: 'success',
        message: `Dismissed suggestion ${suggestionId}.`,
        startedAt: now(),
        finishedAt: now()
      });

      return suggestion;
    }
  };
}
