#!/usr/bin/env node

/**
 * Supabase setup script for SkyIQ project
 * Project: lqqrhnysoqpsebvxwahq.supabase.co
 */

import { createClient } from '@supabase/supabase-js';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from './shared/schema.ts';

// Your Supabase project configuration
const SUPABASE_URL = 'https://lqqrhnysoqpsebvxwahq.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxxcXJobnlzb3Fwc2Vidnh3YWhxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTg3NTQyNzcsImV4cCI6MjA3NDMzMDI3N30.oZfi-FpVrNLvJSNlimTDcBKQ1fniK3orYLbAUpTwzUE';

console.log('🚀 Setting up Supabase for SkyIQ...');
console.log(`📡 Project: ${SUPABASE_URL}\n`);

// Initialize Supabase client
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function testConnection() {
  console.log('🔗 Testing Supabase connection...');
  
  try {
    // Test connection with a simple query
    const { data, error } = await supabase.auth.getSession();
    
    if (error) {
      throw error;
    }
    
    console.log('✅ Supabase connection successful');
    return true;
  } catch (error) {
    console.error('❌ Supabase connection failed:', error.message);
    return false;
  }
}

async function setupDatabase() {
  console.log('📋 Setting up database schema...');
  
  try {
    // This will be handled by Drizzle migrations
    console.log('✅ Database schema will be created via Drizzle');
    console.log('   Run: npm run db:push');
    return true;
  } catch (error) {
    console.error('❌ Error setting up database:', error);
    return false;
  }
}

async function createRLSPolicies() {
  console.log('🔒 Creating Row Level Security policies...');
  
  try {
    // Get database connection string from environment
    if (!process.env.DATABASE_URL) {
      console.log('⚠️  DATABASE_URL not set. Please set it to your Supabase PostgreSQL connection string');
      console.log('   Format: postgresql://postgres:[PASSWORD]@db.lqqrhnysoqpsebvxwahq.supabase.co:5432/postgres');
      return false;
    }
    
    const client = postgres(process.env.DATABASE_URL);
    
    // Enable RLS on all tables
    const tables = ['users', 'calls', 'leads', 'business_info', 'documents', 'document_chunks', 'search_queries', 'eleven_labs_conversations'];
    
    for (const table of tables) {
      console.log(`   Setting up RLS for ${table}...`);
      
      try {
        // Enable RLS
        await client`
          ALTER TABLE ${client(table)} ENABLE ROW LEVEL SECURITY;
        `;
        
        // Create policy for users to access their own data
        await client`
          CREATE POLICY "Users can access their own data" ON ${client(table)}
          FOR ALL USING (user_id = auth.uid()::integer);
        `;
        
        console.log(`   ✅ RLS enabled for ${table}`);
      } catch (error) {
        if (error.message.includes('already exists')) {
          console.log(`   ⚠️  RLS already exists for ${table}`);
        } else {
          console.log(`   ❌ Error setting up RLS for ${table}:`, error.message);
        }
      }
    }
    
    await client.end();
    console.log('✅ RLS policies created successfully');
    return true;
  } catch (error) {
    console.error('❌ Error creating RLS policies:', error);
    return false;
  }
}

async function createIndexes() {
  console.log('📊 Creating database indexes...');
  
  try {
    if (!process.env.DATABASE_URL) {
      console.log('⚠️  DATABASE_URL not set. Skipping index creation.');
      return false;
    }
    
    const client = postgres(process.env.DATABASE_URL);
    
    const indexes = [
      'CREATE INDEX IF NOT EXISTS idx_calls_user_id ON calls(user_id);',
      'CREATE INDEX IF NOT EXISTS idx_calls_created_at ON calls(created_at);',
      'CREATE INDEX IF NOT EXISTS idx_calls_twilio_sid ON calls(twilio_call_sid);',
      'CREATE INDEX IF NOT EXISTS idx_calls_status ON calls(status);',
      'CREATE INDEX IF NOT EXISTS idx_business_info_user_id ON business_info(user_id);',
      'CREATE INDEX IF NOT EXISTS idx_documents_user_id ON documents(user_id);',
      'CREATE INDEX IF NOT EXISTS idx_document_chunks_user_id ON document_chunks(user_id);',
      'CREATE INDEX IF NOT EXISTS idx_leads_user_id ON leads(user_id);',
      'CREATE INDEX IF NOT EXISTS idx_eleven_labs_conversations_user_id ON eleven_labs_conversations(user_id);',
      'CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);',
      'CREATE INDEX IF NOT EXISTS idx_users_api_key ON users(api_key);'
    ];
    
    for (const indexQuery of indexes) {
      try {
        await client`${client.unsafe(indexQuery)}`;
        console.log(`   ✅ Created index: ${indexQuery.split(' ')[5]}`);
      } catch (error) {
        if (error.message.includes('already exists')) {
          console.log(`   ⚠️  Index already exists: ${indexQuery.split(' ')[5]}`);
        } else {
          console.log(`   ❌ Error creating index: ${error.message}`);
        }
      }
    }
    
    await client.end();
    console.log('✅ Database indexes created successfully');
    return true;
  } catch (error) {
    console.error('❌ Error creating indexes:', error);
    return false;
  }
}

async function main() {
  console.log('🎯 SkyIQ Supabase Setup');
  console.log('========================\n');
  
  // Step 1: Test connection
  const connectionOk = await testConnection();
  if (!connectionOk) {
    console.error('❌ Cannot proceed without Supabase connection');
    process.exit(1);
  }
  
  // Step 2: Setup database schema
  const schemaOk = await setupDatabase();
  if (!schemaOk) {
    console.error('❌ Database schema setup failed');
    process.exit(1);
  }
  
  // Step 3: Create RLS policies
  const rlsOk = await createRLSPolicies();
  if (!rlsOk) {
    console.log('⚠️  RLS setup skipped (DATABASE_URL not set)');
  }
  
  // Step 4: Create indexes
  const indexesOk = await createIndexes();
  if (!indexesOk) {
    console.log('⚠️  Index creation skipped (DATABASE_URL not set)');
  }
  
  console.log('\n🎉 Supabase setup completed!');
  console.log('\n📝 Next steps:');
  console.log('   1. Get your database password from Supabase dashboard');
  console.log('   2. Set DATABASE_URL in your .env file:');
  console.log('      DATABASE_URL=postgresql://postgres:[PASSWORD]@db.lqqrhnysoqpsebvxwahq.supabase.co:5432/postgres');
  console.log('   3. Run: npm run db:push');
  console.log('   4. Test your application');
  console.log('\n🔗 Supabase Dashboard: https://supabase.com/dashboard/project/lqqrhnysoqpsebvxwahq');
}

main().catch(console.error);
