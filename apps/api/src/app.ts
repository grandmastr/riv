import { Hono } from 'hono';
import { z } from 'zod';
import type { AgentRuntime } from '@riv/agent';

import { AgentRuntimeError } from '@riv/agent';
import { createAuthService, type AuthService } from './auth';

const CreateThreadBodySchema = z.object({
  title: z.string().min(1)
});

const CreateMessageBodySchema = z.object({
  content: z.string().min(1),
  attachments: z.array(z.any()).default([])
});

const CreateMemoryBodySchema = z.object({
  title: z.string().min(1),
  content: z.string().min(1)
});

function sseResponse(stream: Iterable<unknown>) {
  const encoder = new TextEncoder();

  return new Response(
    new ReadableStream({
      async start(controller) {
        for await (const item of stream) {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(item)}\n\n`)
          );
        }

        controller.close();
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

  throw error;
}

export function createApp(options: {
  runtime: AgentRuntime;
  authService?: AuthService;
  now?: () => string;
}) {
  const app = new Hono();
  const authService = options.authService ?? createAuthService();

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
      const events = [];

      for await (const event of options.runtime.runAssistantTurn({
        threadId: context.req.param('threadId'),
        userId: viewer.id,
        content: body.content,
        attachments: body.attachments
      })) {
        events.push(event);
      }

      return sseResponse(events);
    } catch (error) {
      return createJsonError(error);
    }
  });

  app.post('/threads/:threadId/action-proposals/:proposalId/confirm', async (context) => {
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
  });

  app.post('/threads/:threadId/action-proposals/:proposalId/reject', async (context) => {
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
  });

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
