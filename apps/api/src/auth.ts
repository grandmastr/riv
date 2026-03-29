import type { Context } from 'hono';

export type Viewer = {
  id: string;
};

export type BetterAuthSession = {
  user: {
    id: string;
  };
};

export interface AuthService {
  resolveViewer(context: Context): Promise<Viewer>;
}

export type BetterAuthSessionResolver = (
  request: Request
) => Promise<BetterAuthSession | null>;

export function createAuthService(options?: {
  fallbackUserId?: string;
  getSession?: BetterAuthSessionResolver;
}): AuthService {
  const fallbackUserId = options?.fallbackUserId ?? 'user_dev';

  return {
    async resolveViewer(context) {
      const session = options?.getSession
        ? await options.getSession(context.req.raw)
        : null;

      if (session?.user.id) {
        return {
          id: session.user.id
        };
      }

      const headerUserId = context.req.header('x-riv-user-id');
      return {
        id: headerUserId || fallbackUserId
      };
    }
  };
}
