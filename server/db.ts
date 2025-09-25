import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from "@shared/schema";

const client = postgres(process.env.DATABASE_URL!, { 
  ssl: 'require',
  options: '--inet4-only'
});
export const db = drizzle(client, { schema });