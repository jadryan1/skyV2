import postgres from 'postgres';

// Try different hostname formats
const connectionStrings = [
  'postgresql://postgres:Goyard09%24@db.lqqrhnysoqpsebvxwahq.supabase.co:5432/postgres',
  'postgresql://postgres:Goyard09%24@lqqrhnysoqpsebvxwahq.supabase.co:5432/postgres',
  'postgresql://postgres:Goyard09%24@aws-0-us-east-1.pooler.supabase.com:5432/postgres'
];

for (let i = 0; i < connectionStrings.length; i++) {
  const connStr = connectionStrings[i];
  console.log(`\n🔗 Testing connection ${i + 1}: ${connStr.split('@')[1]}`);
  
  try {
    const client = postgres(connStr);
    const result = await client`SELECT 1 as test`;
    console.log('✅ Connection successful!');
    console.log('Result:', result);
    await client.end();
    break;
  } catch (error) {
    console.log('❌ Connection failed:', error.message);
  }
}
