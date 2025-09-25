import { createClient } from '@supabase/supabase-js';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from './shared/schema.ts';

const supabaseUrl = 'https://lqqrhnysoqpsebvxwahq.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxxcXJobnlzb3Fwc2Vidnh3YWhxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTg3NTQyNzcsImV4cCI6MjA3NDMzMDI3N30.oZfi-FpVrNLvJSNlimTDcBKQ1fniK3orYLbAUpTwzUE';

const supabase = createClient(supabaseUrl, supabaseKey);

console.log('🧪 Testing Supabase Integration...\n');

async function testSupabaseConnection() {
  try {
    console.log('1. Testing Supabase client connection...');
    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;
    console.log('   ✅ Supabase client connected');
    return true;
  } catch (error) {
    console.log('   ❌ Supabase client failed:', error.message);
    return false;
  }
}

async function testDatabaseConnection() {
  try {
    console.log('2. Testing database connection...');
    const client = postgres('postgresql://postgres:Goyard09%24@db.lqqrhnysoqpsebvxwahq.supabase.co:5432/postgres');
    const result = await client`SELECT 1 as test`;
    await client.end();
    console.log('   ✅ Database connection successful');
    return true;
  } catch (error) {
    console.log('   ❌ Database connection failed:', error.message);
    return false;
  }
}

async function testTableAccess() {
  try {
    console.log('3. Testing table access...');
    const tables = ['users', 'calls', 'leads', 'business_info'];
    
    for (const table of tables) {
      const { data, error } = await supabase.from(table).select('*').limit(1);
      if (error && error.code !== 'PGRST116') {
        throw new Error(`Table ${table}: ${error.message}`);
      }
      console.log(`   ✅ Table ${table} accessible`);
    }
    return true;
  } catch (error) {
    console.log('   ❌ Table access failed:', error.message);
    return false;
  }
}

async function testDataInsertion() {
  try {
    console.log('4. Testing data insertion...');
    
    // Test inserting a user
    const testUser = {
      id: crypto.randomUUID(),
      email: 'test@skyiq.com',
      password: 'hashed_password',
      business_name: 'Test Business',
      phone_number: '+1234567890',
      service_plan: 'inbound'
    };
    
    const { data, error } = await supabase
      .from('users')
      .insert(testUser)
      .select();
    
    if (error) throw error;
    console.log('   ✅ User insertion successful');
    
    // Clean up test data
    await supabase.from('users').delete().eq('id', testUser.id);
    console.log('   ✅ Test data cleaned up');
    
    return true;
  } catch (error) {
    console.log('   ❌ Data insertion failed:', error.message);
    return false;
  }
}

async function main() {
  const results = {
    supabase: await testSupabaseConnection(),
    database: await testDatabaseConnection(),
    tables: await testTableAccess(),
    insertion: await testDataInsertion()
  };
  
  console.log('\n📊 Test Results:');
  console.log('================');
  Object.entries(results).forEach(([test, passed]) => {
    console.log(`${passed ? '✅' : '❌'} ${test}: ${passed ? 'PASSED' : 'FAILED'}`);
  });
  
  const allPassed = Object.values(results).every(Boolean);
  
  if (allPassed) {
    console.log('\n🎉 All tests passed! Your Supabase integration is working perfectly.');
    console.log('\n📝 Next steps:');
    console.log('1. Update your .env file with the DATABASE_URL');
    console.log('2. Run: npm run dev');
    console.log('3. Start using your SkyIQ dashboard!');
  } else {
    console.log('\n⚠️  Some tests failed. Please check the errors above.');
  }
}

main().catch(console.error);
