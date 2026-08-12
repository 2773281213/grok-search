import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'sqlite',
  schema: './src/schema.ts',
  out: './drizzle',
  dbCredentials: {
    url: process.env.CAIRN_DB_PATH ?? './data/cairn.db',
  },
});
