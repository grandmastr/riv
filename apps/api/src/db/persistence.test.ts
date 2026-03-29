import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createPersistenceLayer } from './persistence';

const { postgresMock, drizzleMock } = vi.hoisted(() => ({
  postgresMock: vi.fn(() => ({ end: vi.fn() })),
  drizzleMock: vi.fn(() => ({ tag: 'db' }))
}));

vi.mock('postgres', () => ({
  default: postgresMock
}));

vi.mock('drizzle-orm/postgres-js', () => ({
  drizzle: drizzleMock
}));

describe('createPersistenceLayer', () => {
  beforeEach(() => {
    postgresMock.mockClear();
    drizzleMock.mockClear();
  });

  it('falls back to in-memory persistence when DATABASE_URL is absent', () => {
    const layer = createPersistenceLayer({});

    expect(layer.kind).toBe('memory');
    expect(layer.repositories).toBeUndefined();
    expect(postgresMock).not.toHaveBeenCalled();
    expect(drizzleMock).not.toHaveBeenCalled();
  });

  it('creates a Supabase postgres-js client with prepare disabled', () => {
    const layer = createPersistenceLayer({
      databaseUrl:
        'postgresql://postgres.project:[YOUR-PASSWORD]@aws-1-eu-central-1.pooler.supabase.com:6543/postgres'
    });

    expect(layer.kind).toBe('supabase');
    expect(postgresMock).toHaveBeenCalledWith(
      'postgresql://postgres.project:[YOUR-PASSWORD]@aws-1-eu-central-1.pooler.supabase.com:6543/postgres',
      { prepare: false }
    );
    expect(drizzleMock).toHaveBeenCalledTimes(1);
    expect(layer.repositories?.threads).toBeDefined();
    expect(layer.repositories?.messages).toBeDefined();
    expect(layer.repositories?.proposals).toBeDefined();
    expect(layer.repositories?.memories).toBeDefined();
  });
});
