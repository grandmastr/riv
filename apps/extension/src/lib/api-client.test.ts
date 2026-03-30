import { afterEach, describe, expect, it, vi } from 'vitest';

import { createThread } from './api-client';

const originalFetch = globalThis.fetch;

afterEach(() => {
  vi.restoreAllMocks();
  globalThis.fetch = originalFetch;
});

describe('createThread', () => {
  it('surfaces the backend error payload when thread creation fails', async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            error: 'password authentication failed for user "postgres"'
          }),
          {
            status: 500,
            headers: {
              'content-type': 'application/json'
            }
          }
        )
    ) as typeof fetch;

    await expect(createThread('Riva session')).rejects.toThrow(
      'password authentication failed for user "postgres"'
    );
  });
});
