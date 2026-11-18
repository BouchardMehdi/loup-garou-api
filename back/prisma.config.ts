import { config } from 'dotenv';
import { defineConfig } from 'prisma/config';
import { databaseUrl } from './src/config/database-url.js';

config({ path: '../.env', quiet: true });
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url: databaseUrl(process.env) },
});
