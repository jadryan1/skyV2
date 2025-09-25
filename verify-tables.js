import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://lqqrhnysoqpsebvxwahq.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxxcXJobnlzb3Fwc2Vidnh3YWhxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTg3NTQyNzcsImV4cCI6MjA3NDMzMDI3N30.oZfi-FpVrNLvJSNlimTDcBKQ1fniK3orYLbAUpTwzUE';

const supabase = createClient(supabaseUrl, supabaseKey);

console.log('🔍 Verifying Supabase tables...\n');

const tables = [
  'users',
  'calls', 
  'leads',
  'business_info',
  'documents',
  'document_chunks',
  'search_queries',
  'eleven_labs_conversations'
];

async function verifyTables() {
  let allTablesExist = true;
  
  for (const table of tables) {
    try {
      const { data, error } = await supabase.from(table).select('*').limit(1);
      
      if (error) {
        if (error.code === 'PGRST116') {
          console.log(`❌ Table ${table}: Does not exist`);
          allTablesExist = false;
        } else {
          console.log(`❌ Table ${table}: Error - ${error.message}`);
          allTablesExist = false;
        }
      } else {
        console.log(`✅ Table ${table}: Ready (${data.length} rows)`);
      }
    } catch (err) {
      console.log(`❌ Table ${table}: ${err.message}`);
      allTablesExist = false;
    }
  }
  
  console.log('\n📊 Summary:');
  if (allTablesExist) {
    console.log('🎉 All tables are ready! Your SkyIQ database is fully set up.');
    console.log('\n📝 Next steps:');
    console.log('1. Update your .env file with the DATABASE_URL');
    console.log('2. Test your application: npm run dev');
    console.log('3. Start using your SkyIQ dashboard!');
  } else {
    console.log('⚠️  Some tables are missing. Please run the SQL schema in your Supabase dashboard.');
    console.log('\n📝 To fix this:');
    console.log('1. Go to: https://supabase.com/dashboard/project/lqqrhnysoqpsebvxwahq');
    console.log('2. Click on "SQL Editor" in the left sidebar');
    console.log('3. Copy and paste the contents of supabase-schema.sql');
    console.log('4. Click "Run" to execute the SQL');
    console.log('5. Run this script again to verify');
  }
}

verifyTables().catch(console.error);
