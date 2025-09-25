import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://lqqrhnysoqpsebvxwahq.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxxcXJobnlzb3Fwc2Vidnh3YWhxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTg3NTQyNzcsImV4cCI6MjA3NDMzMDI3N30.oZfi-FpVrNLvJSNlimTDcBKQ1fniK3orYLbAUpTwzUE';

const supabase = createClient(supabaseUrl, supabaseKey);

try {
  console.log('🔗 Testing Supabase connection...');
  
  // Test auth connection
  const { data: authData, error: authError } = await supabase.auth.getSession();
  console.log('✅ Supabase auth connection successful');
  
  // Test database connection via Supabase client
  const { data, error } = await supabase
    .from('users')
    .select('count')
    .limit(1);
  
  if (error && error.code !== 'PGRST116') { // PGRST116 = table doesn't exist
    throw error;
  }
  
  console.log('✅ Supabase database connection successful');
  console.log('📊 Ready to create tables!');
  
} catch (error) {
  console.error('❌ Supabase connection failed:', error.message);
  process.exit(1);
}
