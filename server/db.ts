import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from "@shared/schema";

// Use DATABASE_URL as single source of truth
if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to configure the database?",
  );
}

// Create the postgres client using DATABASE_URL directly
const client = postgres(process.env.DATABASE_URL, {
  prepare: false,
  max: process.env.NODE_ENV === 'production' ? 10 : 20,
  idle_timeout: 20,
  connect_timeout: 10,
});

export const db = drizzle(client, { schema });