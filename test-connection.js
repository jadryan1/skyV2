import postgres from 'postgres';

const client = postgres('postgresql://postgres:Goyard09%24@db.lqqrhnysoqpsebvxwahq.supabase.co:5432/postgres');

try {
  console.log('🔗 Testing database connection...');
  const result = await client`SELECT 1 as test`;
  console.log('✅ Database connection successful:', result);
  await client.end();
} catch (error) {
  console.error('❌ Database connection failed:', error.message);
  process.exit(1);
}
