-- SkyIQ Database Schema for Supabase
-- Copy and paste this into your Supabase SQL Editor

-- Create users table
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
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
  user_id UUID NOT NULL REFERENCES users(id),
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
  user_id UUID NOT NULL REFERENCES users(id),
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
  user_id UUID NOT NULL REFERENCES users(id) UNIQUE,
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
  user_id UUID NOT NULL REFERENCES users(id),
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
  user_id UUID NOT NULL REFERENCES users(id),
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
  user_id UUID NOT NULL REFERENCES users(id),
  query TEXT NOT NULL,
  results_count INTEGER NOT NULL,
  response_time INTEGER,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Create eleven_labs_conversations table
CREATE TABLE IF NOT EXISTS eleven_labs_conversations (
  id SERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id),
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

-- Create indexes for better performance
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

-- Enable Row Level Security on all tables
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE calls ENABLE ROW LEVEL SECURITY;
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE business_info ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE search_queries ENABLE ROW LEVEL SECURITY;
ALTER TABLE eleven_labs_conversations ENABLE ROW LEVEL SECURITY;

-- Create RLS policies (users can only access their own data)
CREATE POLICY "Users can access their own data" ON users FOR ALL USING (id = auth.uid());
CREATE POLICY "Users can access their own data" ON calls FOR ALL USING (user_id = auth.uid());
CREATE POLICY "Users can access their own data" ON leads FOR ALL USING (user_id = auth.uid());
CREATE POLICY "Users can access their own data" ON business_info FOR ALL USING (user_id = auth.uid());
CREATE POLICY "Users can access their own data" ON documents FOR ALL USING (user_id = auth.uid());
CREATE POLICY "Users can access their own data" ON document_chunks FOR ALL USING (user_id = auth.uid());
CREATE POLICY "Users can access their own data" ON search_queries FOR ALL USING (user_id = auth.uid());
CREATE POLICY "Users can access their own data" ON eleven_labs_conversations FOR ALL USING (user_id = auth.uid());
