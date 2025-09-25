#!/usr/bin/env node

/**
 * Helper script to get your Supabase database URL
 */

console.log('🔑 Supabase Database URL Setup');
console.log('================================\n');

console.log('To get your database password:');
console.log('1. Go to: https://supabase.com/dashboard/project/lqqrhnysoqpsebvxwahq');
console.log('2. Click on "Settings" in the left sidebar');
console.log('3. Click on "Database"');
console.log('4. Scroll down to "Connection string"');
console.log('5. Copy the "URI" connection string\n');

console.log('Your connection string should look like:');
console.log('postgresql://postgres:[YOUR-PASSWORD]@db.lqqrhnysoqpsebvxwahq.supabase.co:5432/postgres\n');

console.log('Once you have the password, run:');
console.log('export DATABASE_URL="postgresql://postgres:[YOUR-PASSWORD]@db.lqqrhnysoqpsebvxwahq.supabase.co:5432/postgres"');
console.log('npm run db:push\n');

console.log('Or add it to your .env file:');
console.log('DATABASE_URL=postgresql://postgres:[YOUR-PASSWORD]@db.lqqrhnysoqpsebvxwahq.supabase.co:5432/postgres\n');

console.log('🔗 Direct link to your database settings:');
console.log('https://supabase.com/dashboard/project/lqqrhnysoqpsebvxwahq/settings/database');
