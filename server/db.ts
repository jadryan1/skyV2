import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from "@shared/schema";

// Check for Supabase environment variables first
if (!process.env.SUPABASE_URL) {
  throw new Error(
    "SUPABASE_URL must be set. Did you forget to configure Supabase?",
  );
}

if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error(
    "SUPABASE_SERVICE_ROLE_KEY must be set for server-side operations.",
  );
}

// Use the DATABASE_URL if available (for Supabase), otherwise construct it
let databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  // Extract project reference from SUPABASE_URL
  const supabaseUrl = process.env.SUPABASE_URL;
  const projectRef = supabaseUrl.split('//')[1].split('.')[0];
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  
  // Construct Supabase direct connection URL
  databaseUrl = `postgresql://postgres.${projectRef}:${serviceKey}@aws-0-us-west-1.pooler.supabase.com:6543/postgres`;
}

// Create the postgres client for Supabase
const client = postgres(databaseUrl, {
  prepare: false,
  max: process.env.NODE_ENV === 'production' ? 10 : 20,
  idle_timeout: 20,
  connect_timeout: 10,
  ssl: 'require', // Supabase requires SSL
});

export const db = drizzle(client, { schema });