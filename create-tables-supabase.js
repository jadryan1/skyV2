import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://lqqrhnysoqpsebvxwahq.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxxcXJobnlzb3Fwc2Vidnh3YWhxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTg3NTQyNzcsImV4cCI6MjA3NDMzMDI3N30.oZfi-FpVrNLvJSNlimTDcBKQ1fniK3orYLbAUpTwzUE';

const supabase = createClient(supabaseUrl, supabaseKey);

console.log('🚀 Creating tables in Supabase...');

// SQL to create all tables
const createTablesSQL = `
-- Create users table
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password TEXT NOT NULL,
  business_name TEXT NOT NULL,
  phone_number TEXT NOT NULL,
  website TEXT,
  service_plan TEXT NOT NULL,
  verified BOOLEAN DEFAULT FALSE,
  email_verification_token TEXT,
  email_verification_expires TIMESTAMP,
  password_reset_token TEXT,
  password_reset_expires TIMESTAMP,
  api_key TEXT UNIQUE,
  api_key_created_at TIMESTAMP,
  api_key_last_used TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Create calls table
CREATE TABLE IF NOT EXISTS calls (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  phone_number TEXT NOT NULL,
  contact_name TEXT,
  duration INTEGER,
  status TEXT NOT NULL,
  notes TEXT,
  summary TEXT,
  transcript TEXT,
  twilio_call_sid TEXT,
  direction TEXT,
  recording_url TEXT,
  is_from_twilio BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Create leads table
CREATE TABLE IF NOT EXISTS leads (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  phone_number TEXT NOT NULL,
  email TEXT,
  company TEXT,
  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Create business_info table
CREATE TABLE IF NOT EXISTS business_info (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) UNIQUE,
  business_name TEXT,
  business_email TEXT,
  business_phone TEXT,
  business_address TEXT,
  description TEXT,
  links TEXT[],
  file_urls TEXT[],
  file_names TEXT[],
  file_types TEXT[],
  file_sizes TEXT[],
  lead_urls TEXT[],
  lead_names TEXT[],
  lead_types TEXT[],
  lead_sizes TEXT[],
  logo_url TEXT,
  twilio_account_sid TEXT,
  twilio_auth_token TEXT,
  twilio_phone_number TEXT,
  eleven_labs_api_key TEXT,
  eleven_labs_agent_id TEXT,
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Create documents table
CREATE TABLE IF NOT EXISTS documents (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  source_type TEXT NOT NULL,
  source_url TEXT NOT NULL,
  title TEXT NOT NULL,
  content_type TEXT,
  file_size INTEGER,
  extracted_text TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  error_message TEXT,
  processed_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Create document_chunks table
CREATE TABLE IF NOT EXISTS document_chunks (
  id SERIAL PRIMARY KEY,
  document_id INTEGER NOT NULL REFERENCES documents(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  chunk_index INTEGER NOT NULL,
  content TEXT NOT NULL,
  word_count INTEGER NOT NULL,
  summary TEXT,
  keywords TEXT[],
  created_at TIMESTAMP DEFAULT NOW()
);

-- Create search_queries table
CREATE TABLE IF NOT EXISTS search_queries (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  query TEXT NOT NULL,
  results_count INTEGER NOT NULL,
  response_time INTEGER,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Create eleven_labs_conversations table
CREATE TABLE IF NOT EXISTS eleven_labs_conversations (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  conversation_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  status TEXT NOT NULL,
  start_time TIMESTAMP,
  end_time TIMESTAMP,
  duration INTEGER,
  transcript TEXT,
  summary TEXT,
  metadata TEXT,
  phone_number TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_calls_user_id ON calls(user_id);
CREATE INDEX IF NOT EXISTS idx_calls_created_at ON calls(created_at);
CREATE INDEX IF NOT EXISTS idx_calls_twilio_sid ON calls(twilio_call_sid);
CREATE INDEX IF NOT EXISTS idx_business_info_user_id ON business_info(user_id);
CREATE INDEX IF NOT EXISTS idx_documents_user_id ON documents(user_id);
CREATE INDEX IF NOT EXISTS idx_document_chunks_user_id ON document_chunks(user_id);
CREATE INDEX IF NOT EXISTS idx_leads_user_id ON leads(user_id);
CREATE INDEX IF NOT EXISTS idx_eleven_labs_conversations_user_id ON eleven_labs_conversations(user_id);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_api_key ON users(api_key);

-- Enable Row Level Security
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE calls ENABLE ROW LEVEL SECURITY;
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE business_info ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE search_queries ENABLE ROW LEVEL SECURITY;
ALTER TABLE eleven_labs_conversations ENABLE ROW LEVEL SECURITY;

-- Create RLS policies
CREATE POLICY "Users can access their own data" ON users FOR ALL USING (id = auth.uid()::integer);
CREATE POLICY "Users can access their own data" ON calls FOR ALL USING (user_id = auth.uid()::integer);
CREATE POLICY "Users can access their own data" ON leads FOR ALL USING (user_id = auth.uid()::integer);
CREATE POLICY "Users can access their own data" ON business_info FOR ALL USING (user_id = auth.uid()::integer);
CREATE POLICY "Users can access their own data" ON documents FOR ALL USING (user_id = auth.uid()::integer);
CREATE POLICY "Users can access their own data" ON document_chunks FOR ALL USING (user_id = auth.uid()::integer);
CREATE POLICY "Users can access their own data" ON search_queries FOR ALL USING (user_id = auth.uid()::integer);
CREATE POLICY "Users can access their own data" ON eleven_labs_conversations FOR ALL USING (user_id = auth.uid()::integer);
`;

async function createTables() {
  try {
    console.log('📋 Creating tables...');
    
    // Execute the SQL
    const { data, error } = await supabase.rpc('exec_sql', { sql: createTablesSQL });
    
    if (error) {
      console.error('❌ Error creating tables:', error);
      return false;
    }
    
    console.log('✅ Tables created successfully!');
    return true;
  } catch (error) {
    console.error('❌ Error:', error.message);
    return false;
  }
}

// Since we can't use exec_sql directly, let's try a different approach
async function testTables() {
  try {
    console.log('🔍 Testing table access...');
    
    // Try to query each table
    const tables = ['users', 'calls', 'leads', 'business_info', 'documents', 'document_chunks', 'search_queries', 'eleven_labs_conversations'];
    
    for (const table of tables) {
      try {
        const { data, error } = await supabase.from(table).select('*').limit(1);
        if (error && error.code !== 'PGRST116') {
          console.log(`❌ Table ${table}: ${error.message}`);
        } else {
          console.log(`✅ Table ${table}: Ready`);
        }
      } catch (err) {
        console.log(`❌ Table ${table}: ${err.message}`);
      }
    }
  } catch (error) {
    console.error('❌ Error testing tables:', error.message);
  }
}

async function main() {
  console.log('🎯 SkyIQ Supabase Table Creation');
  console.log('=================================\n');
  
  // Test current state
  await testTables();
  
  console.log('\n📝 Next steps:');
  console.log('1. Go to your Supabase dashboard: https://supabase.com/dashboard/project/lqqrhnysoqpsebvxwahq');
  console.log('2. Go to SQL Editor');
  console.log('3. Run the SQL commands from the createTablesSQL variable');
  console.log('4. Or use the Drizzle migration once we fix the connection');
}

main().catch(console.error);
