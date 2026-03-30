import { Hono } from 'hono';
import { z } from 'zod';
import {
  DashboardAutomationsResponseSchema,
  DashboardOverviewResponseSchema,
  GoogleIntegrationStatusSchema,
  ContextAttachmentSchema,
  ConversationMessageSchema,
  ConversationThreadSchema,
  PROTOCOL_VERSION,
  type MessageEnvelope
} from '@riv/contracts';
import type { AgentRuntime } from '@riv/agent';

import { AgentRuntimeError } from '@riv/agent';
import { createAuthService, type AuthService } from './auth';
import {
  createInMemoryDashboardService,
  type DashboardService
} from './dashboard';

const CreateThreadBodySchema = z.object({
  title: z.string().min(1)
});

const CreateMessageBodySchema = z.object({
  content: z.string().min(1),
  attachments: z.array(ContextAttachmentSchema).default([])
});

const CreateStatelessTurnBodySchema = z.object({
  thread: ConversationThreadSchema,
  messages: z.array(ConversationMessageSchema).default([]),
  content: z.string().min(1),
  attachments: z.array(ContextAttachmentSchema).default([])
});

const CreateMemoryBodySchema = z.object({
  title: z.string().min(1),
  content: z.string().min(1)
});

const UpdateAutomationSettingsBodySchema = z.object({
  meetingReminderOffsetsMinutes: z.array(z.number().int().positive()).min(1)
    .optional(),
  enabledMeetingReminders: z.boolean().optional(),
  enabledGmailSuggestions: z.boolean().optional()
});

function createStreamErrorEnvelope(error: unknown): MessageEnvelope {
  return {
    version: PROTOCOL_VERSION,
    type: 'assistant_stream',
    emittedAt: new Date().toISOString(),
    payload: {
      type: 'error',
      message:
        error instanceof Error ? error.message : 'Riv hit an unexpected error.'
    }
  };
}

function sseResponse(stream: AsyncIterable<unknown>) {
  const encoder = new TextEncoder();

  return new Response(
    new ReadableStream({
      async start(controller) {
        try {
          for await (const item of stream) {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify(item)}\n\n`)
            );
          }
        } catch (error) {
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify(createStreamErrorEnvelope(error))}\n\n`
            )
          );
        } finally {
          controller.close();
        }
      }
    }),
    {
      headers: {
        'cache-control': 'no-cache',
        connection: 'keep-alive',
        'content-type': 'text/event-stream; charset=utf-8'
      }
    }
  );
}

function createJsonError(error: unknown) {
  if (error instanceof AgentRuntimeError) {
    return Response.json(
      {
        error: error.message
      },
      {
        status: error.statusCode
      }
    );
  }

  return Response.json(
    {
      error:
        error instanceof Error ? error.message : 'Riv hit an unexpected error.'
    },
    {
      status: 500
    }
  );
}

export function createApp(options: {
  runtime: AgentRuntime;
  authService?: AuthService;
  dashboardService?: DashboardService;
  now?: () => string;
}) {
  const app = new Hono();
  const authService = options.authService ?? createAuthService();
  const dashboardService =
    options.dashboardService ??
    createInMemoryDashboardService({
      now: options.now
    });

  app.onError((error) => createJsonError(error));

  app.post('/threads', async (context) => {
    const viewer = await authService.resolveViewer(context);
    const body = CreateThreadBodySchema.parse(await context.req.json());
    const thread = await options.runtime.createThread({
      title: body.title,
      userId: viewer.id
    });

    return context.json(
      {
        thread
      },
      201
    );
  });

  app.get('/threads/:threadId', async (context) => {
    try {
      const viewer = await authService.resolveViewer(context);
      const detail = await options.runtime.getThreadDetail({
        threadId: context.req.param('threadId'),
        userId: viewer.id
      });

      return context.json(detail);
    } catch (error) {
      return createJsonError(error);
    }
  });

  app.post('/threads/:threadId/messages', async (context) => {
    try {
      const viewer = await authService.resolveViewer(context);
      const body = CreateMessageBodySchema.parse(await context.req.json());
      return sseResponse(
        options.runtime.runAssistantTurn({
          threadId: context.req.param('threadId'),
          userId: viewer.id,
          content: body.content,
          attachments: body.attachments
        })
      );
    } catch (error) {
      return createJsonError(error);
    }
  });

  app.post('/turns/stateless', async (context) => {
    try {
      const viewer = await authService.resolveViewer(context);
      const body = CreateStatelessTurnBodySchema.parse(
        await context.req.json()
      );
      return sseResponse(
        options.runtime.runStatelessAssistantTurn({
          userId: viewer.id,
          thread: body.thread,
          messages: body.messages,
          content: body.content,
          attachments: body.attachments
        })
      );
    } catch (error) {
      return createJsonError(error);
    }
  });

  app.post(
    '/threads/:threadId/action-proposals/:proposalId/confirm',
    async (context) => {
      try {
        const viewer = await authService.resolveViewer(context);
        const resolution = await options.runtime.confirmActionProposal({
          actorUserId: viewer.id,
          proposalId: context.req.param('proposalId'),
          threadId: context.req.param('threadId')
        });

        return context.json(resolution);
      } catch (error) {
        return createJsonError(error);
      }
    }
  );

  app.post(
    '/threads/:threadId/action-proposals/:proposalId/reject',
    async (context) => {
      try {
        const viewer = await authService.resolveViewer(context);
        const resolution = await options.runtime.rejectActionProposal({
          actorUserId: viewer.id,
          proposalId: context.req.param('proposalId'),
          threadId: context.req.param('threadId')
        });

        return context.json(resolution);
      } catch (error) {
        return createJsonError(error);
      }
    }
  );

  app.get('/me/memories', async (context) => {
    const viewer = await authService.resolveViewer(context);
    const memories = await options.runtime.listMemories({
      userId: viewer.id
    });

    return context.json({
      memories
    });
  });

  app.post('/me/memories', async (context) => {
    const viewer = await authService.resolveViewer(context);
    const body = CreateMemoryBodySchema.parse(await context.req.json());
    const memory = await options.runtime.createMemory({
      userId: viewer.id,
      title: body.title,
      content: body.content
    });

    return context.json(
      {
        memory
      },
      201
    );
  });

  app.get('/me/integrations/google', async (context) => {
    const viewer = await authService.resolveViewer(context);
    const integration = GoogleIntegrationStatusSchema.parse(
      await dashboardService.getGoogleIntegrationStatus(viewer.id)
    );

    return context.json({
      integration
    });
  });

  app.post('/me/integrations/google/connect', async (context) => {
    const viewer = await authService.resolveViewer(context);
    const integration = GoogleIntegrationStatusSchema.parse(
      await dashboardService.connectGoogle(viewer.id)
    );

    return context.json({
      integration
    });
  });

  app.post('/me/integrations/google/disconnect', async (context) => {
    const viewer = await authService.resolveViewer(context);
    const integration = GoogleIntegrationStatusSchema.parse(
      await dashboardService.disconnectGoogle(viewer.id)
    );

    return context.json({
      integration
    });
  });

  app.get('/me/dashboard/overview', async (context) => {
    const viewer = await authService.resolveViewer(context);
    const overview = DashboardOverviewResponseSchema.parse(
      await dashboardService.getOverview(viewer.id)
    );

    return context.json(overview);
  });

  app.get('/me/dashboard/automations', async (context) => {
    const viewer = await authService.resolveViewer(context);
    const automations = DashboardAutomationsResponseSchema.parse(
      await dashboardService.getAutomations(viewer.id)
    );

    return context.json(automations);
  });

  app.patch('/me/dashboard/automation-settings', async (context) => {
    const viewer = await authService.resolveViewer(context);
    const body = UpdateAutomationSettingsBodySchema.parse(
      await context.req.json()
    );
    const settings = await dashboardService.updateAutomationSettings(
      viewer.id,
      body
    );

    return context.json({
      settings
    });
  });

  app.post('/me/dashboard/suggestions/:suggestionId/dismiss', async (context) => {
    const viewer = await authService.resolveViewer(context);
    const suggestion = await dashboardService.dismissSuggestion(
      viewer.id,
      context.req.param('suggestionId')
    );

    if (!suggestion) {
      return context.json(
        {
          error: 'Suggestion was not found.'
        },
        404
      );
    }

    return context.json({
      suggestion
    });
  });

  return {
    app,
    authService
  };
}
