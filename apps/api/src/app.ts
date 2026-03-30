import { Hono } from 'hono';
import { z } from 'zod';
import {
  ContextAttachmentSchema,
  ConversationMessageSchema,
  ConversationThreadSchema,
  PROTOCOL_VERSION,
  type MessageEnvelope
} from '@riv/contracts';
import type { AgentRuntime } from '@riv/agent';

import { AgentRuntimeError } from '@riv/agent';
import { createAuthService, type AuthService } from './auth';

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
  now?: () => string;
}) {
  const app = new Hono();
  const authService = options.authService ?? createAuthService();

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

  return {
    app,
    authService
  };
}
