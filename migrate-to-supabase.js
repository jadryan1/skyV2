#!/usr/bin/env node

/**
 * Migration script to set up Supabase database for SkyIQ
 * This script will help you migrate from Neon to Supabase
 */

import { createClient } from '@supabase/supabase-js';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from './shared/schema.js';

console.log('🚀 Starting Supabase migration for SkyIQ...\n');

// Check environment variables
const requiredEnvVars = [
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY', 
  'DATABASE_URL'
];

const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);
if (missingVars.length > 0) {
  console.error('❌ Missing required environment variables:');
  missingVars.forEach(varName => console.error(`   - ${varName}`));
  console.error('\nPlease set these in your .env file');
  process.exit(1);
}

// Initialize Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// Initialize database connection
const client = postgres(process.env.DATABASE_URL);
const db = drizzle(client, { schema });

async function createTables() {
  console.log('📋 Creating database tables...');
  
  try {
    // This will be handled by Drizzle migrations
    console.log('✅ Tables will be created via Drizzle migrations');
    console.log('   Run: npm run db:push');
    return true;
  } catch (error) {
    console.error('❌ Error creating tables:', error);
    return false;
  }
}

async function setupRLSPolicies() {
  console.log('🔒 Setting up Row Level Security policies...');
  
  try {
    // Enable RLS on all tables
    const tables = ['users', 'calls', 'leads', 'business_info', 'documents', 'document_chunks', 'search_queries', 'eleven_labs_conversations'];
    
    for (const table of tables) {
      console.log(`   Setting up RLS for ${table}...`);
      
      // Enable RLS
      await client`
        ALTER TABLE ${client(table)} ENABLE ROW LEVEL SECURITY;
      `;
      
      // Create policy for users to access their own data
      await client`
        CREATE POLICY "Users can access their own data" ON ${client(table)}
        FOR ALL USING (user_id = auth.uid()::integer);
      `;
    }
    
    console.log('✅ RLS policies created successfully');
    return true;
  } catch (error) {
    console.error('❌ Error setting up RLS policies:', error);
    return false;
  }
}

async function createIndexes() {
  console.log('📊 Creating database indexes...');
  
  try {
    const indexes = [
      'CREATE INDEX IF NOT EXISTS idx_calls_user_id ON calls(user_id);',
      'CREATE INDEX IF NOT EXISTS idx_calls_created_at ON calls(created_at);',
      'CREATE INDEX IF NOT EXISTS idx_calls_twilio_sid ON calls(twilio_call_sid);',
      'CREATE INDEX IF NOT EXISTS idx_calls_status ON calls(status);',
      'CREATE INDEX IF NOT EXISTS idx_business_info_user_id ON business_info(user_id);',
      'CREATE INDEX IF NOT EXISTS idx_documents_user_id ON documents(user_id);',
      'CREATE INDEX IF NOT EXISTS idx_document_chunks_user_id ON document_chunks(user_id);',
      'CREATE INDEX IF NOT EXISTS idx_leads_user_id ON leads(user_id);',
      'CREATE INDEX IF NOT EXISTS idx_eleven_labs_conversations_user_id ON eleven_labs_conversations(user_id);'
    ];
    
    for (const indexQuery of indexes) {
      await client`${client.unsafe(indexQuery)}`;
    }
    
    console.log('✅ Database indexes created successfully');
    return true;
  } catch (error) {
    console.error('❌ Error creating indexes:', error);
    return false;
  }
}

async function main() {
  try {
    console.log('🔗 Testing database connection...');
    await client`SELECT 1`;
    console.log('✅ Database connection successful\n');
    
    // Step 1: Create tables
    const tablesCreated = await createTables();
    if (!tablesCreated) {
      console.error('❌ Failed to create tables');
      process.exit(1);
    }
    
    // Step 2: Set up RLS policies
    const rlsSetup = await setupRLSPolicies();
    if (!rlsSetup) {
      console.error('❌ Failed to set up RLS policies');
      process.exit(1);
    }
    
    // Step 3: Create indexes
    const indexesCreated = await createIndexes();
    if (!indexesCreated) {
      console.error('❌ Failed to create indexes');
      process.exit(1);
    }
    
    console.log('\n🎉 Supabase migration completed successfully!');
    console.log('\n📝 Next steps:');
    console.log('   1. Run: npm run db:push');
    console.log('   2. Update your environment variables');
    console.log('   3. Test your application');
    console.log('   4. Migrate existing data if needed');
    
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  } finally {
    await client.end();
  }
}

main();
