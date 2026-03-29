import { config as loadDotenv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'drizzle-kit';

const rootDirectory = fileURLToPath(new URL('.', import.meta.url));
loadDotenv({
  path: `${rootDirectory}.env`
});

const databaseUrl =
  process.env.DATABASE_MIGRATION_URL ??
  process.env.DATABASE_DIRECT_URL ??
  process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error('DATABASE_URL is required to run Drizzle commands.');
}

export default defineConfig({
  schema: `${rootDirectory}drizzle/schema.ts`,
  out: `${rootDirectory}drizzle/migrations`,
  dialect: 'postgresql',
  dbCredentials: {
    url: databaseUrl
  },
  strict: true,
  verbose: true
});
