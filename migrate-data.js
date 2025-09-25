#!/usr/bin/env node

/**
 * Data migration script to move data from Neon to Supabase
 * Run this after setting up your Supabase database
 */

import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from './shared/schema.js';

console.log('🔄 Starting data migration from Neon to Supabase...\n');

// Source database (Neon)
const sourceClient = postgres(process.env.OLD_DATABASE_URL);
const sourceDb = drizzle(sourceClient, { schema });

// Target database (Supabase)
const targetClient = postgres(process.env.DATABASE_URL);
const targetDb = drizzle(targetClient, { schema });

async function migrateUsers() {
  console.log('👥 Migrating users...');
  
  try {
    const users = await sourceDb.select().from(schema.users);
    console.log(`   Found ${users.length} users to migrate`);
    
    for (const user of users) {
      await targetDb.insert(schema.users).values(user).onConflictDoNothing();
    }
    
    console.log('✅ Users migrated successfully');
    return users.length;
  } catch (error) {
    console.error('❌ Error migrating users:', error);
    return 0;
  }
}

async function migrateBusinessInfo() {
  console.log('🏢 Migrating business info...');
  
  try {
    const businessInfo = await sourceDb.select().from(schema.businessInfo);
    console.log(`   Found ${businessInfo.length} business info records to migrate`);
    
    for (const info of businessInfo) {
      await targetDb.insert(schema.businessInfo).values(info).onConflictDoNothing();
    }
    
    console.log('✅ Business info migrated successfully');
    return businessInfo.length;
  } catch (error) {
    console.error('❌ Error migrating business info:', error);
    return 0;
  }
}

async function migrateCalls() {
  console.log('📞 Migrating calls...');
  
  try {
    const calls = await sourceDb.select().from(schema.calls);
    console.log(`   Found ${calls.length} calls to migrate`);
    
    for (const call of calls) {
      await targetDb.insert(schema.calls).values(call).onConflictDoNothing();
    }
    
    console.log('✅ Calls migrated successfully');
    return calls.length;
  } catch (error) {
    console.error('❌ Error migrating calls:', error);
    return 0;
  }
}

async function migrateLeads() {
  console.log('🎯 Migrating leads...');
  
  try {
    const leads = await sourceDb.select().from(schema.leads);
    console.log(`   Found ${leads.length} leads to migrate`);
    
    for (const lead of leads) {
      await targetDb.insert(schema.leads).values(lead).onConflictDoNothing();
    }
    
    console.log('✅ Leads migrated successfully');
    return leads.length;
  } catch (error) {
    console.error('❌ Error migrating leads:', error);
    return 0;
  }
}

async function migrateDocuments() {
  console.log('📄 Migrating documents...');
  
  try {
    const documents = await sourceDb.select().from(schema.documents);
    console.log(`   Found ${documents.length} documents to migrate`);
    
    for (const doc of documents) {
      await targetDb.insert(schema.documents).values(doc).onConflictDoNothing();
    }
    
    console.log('✅ Documents migrated successfully');
    return documents.length;
  } catch (error) {
    console.error('❌ Error migrating documents:', error);
    return 0;
  }
}

async function migrateDocumentChunks() {
  console.log('📝 Migrating document chunks...');
  
  try {
    const chunks = await sourceDb.select().from(schema.documentChunks);
    console.log(`   Found ${chunks.length} document chunks to migrate`);
    
    for (const chunk of chunks) {
      await targetDb.insert(schema.documentChunks).values(chunk).onConflictDoNothing();
    }
    
    console.log('✅ Document chunks migrated successfully');
    return chunks.length;
  } catch (error) {
    console.error('❌ Error migrating document chunks:', error);
    return 0;
  }
}

async function migrateElevenLabsConversations() {
  console.log('🤖 Migrating ElevenLabs conversations...');
  
  try {
    const conversations = await sourceDb.select().from(schema.elevenLabsConversations);
    console.log(`   Found ${conversations.length} conversations to migrate`);
    
    for (const conv of conversations) {
      await targetDb.insert(schema.elevenLabsConversations).values(conv).onConflictDoNothing();
    }
    
    console.log('✅ ElevenLabs conversations migrated successfully');
    return conversations.length;
  } catch (error) {
    console.error('❌ Error migrating ElevenLabs conversations:', error);
    return 0;
  }
}

async function verifyMigration() {
  console.log('🔍 Verifying migration...');
  
  try {
    const sourceCounts = {
      users: (await sourceDb.select().from(schema.users)).length,
      businessInfo: (await sourceDb.select().from(schema.businessInfo)).length,
      calls: (await sourceDb.select().from(schema.calls)).length,
      leads: (await sourceDb.select().from(schema.leads)).length,
      documents: (await sourceDb.select().from(schema.documents)).length,
      documentChunks: (await sourceDb.select().from(schema.documentChunks)).length,
      conversations: (await sourceDb.select().from(schema.elevenLabsConversations)).length,
    };
    
    const targetCounts = {
      users: (await targetDb.select().from(schema.users)).length,
      businessInfo: (await targetDb.select().from(schema.businessInfo)).length,
      calls: (await targetDb.select().from(schema.calls)).length,
      leads: (await targetDb.select().from(schema.leads)).length,
      documents: (await targetDb.select().from(schema.documents)).length,
      documentChunks: (await targetDb.select().from(schema.documentChunks)).length,
      conversations: (await targetDb.select().from(schema.elevenLabsConversations)).length,
    };
    
    console.log('\n📊 Migration Summary:');
    console.log('┌─────────────────┬─────────┬─────────┬─────────┐');
    console.log('│ Table           │ Source  │ Target  │ Status  │');
    console.log('├─────────────────┼─────────┼─────────┼─────────┤');
    
    Object.keys(sourceCounts).forEach(table => {
      const source = sourceCounts[table];
      const target = targetCounts[table];
      const status = source === target ? '✅' : '❌';
      console.log(`│ ${table.padEnd(15)} │ ${source.toString().padEnd(7)} │ ${target.toString().padEnd(7)} │ ${status}     │`);
    });
    
    console.log('└─────────────────┴─────────┴─────────┴─────────┘');
    
    const allMatch = Object.keys(sourceCounts).every(table => 
      sourceCounts[table] === targetCounts[table]
    );
    
    if (allMatch) {
      console.log('\n🎉 Migration completed successfully!');
    } else {
      console.log('\n⚠️  Some data may not have migrated correctly');
    }
    
  } catch (error) {
    console.error('❌ Error verifying migration:', error);
  }
}

async function main() {
  if (!process.env.OLD_DATABASE_URL) {
    console.error('❌ OLD_DATABASE_URL environment variable is required');
    console.error('   Set it to your Neon database connection string');
    process.exit(1);
  }
  
  if (!process.env.DATABASE_URL) {
    console.error('❌ DATABASE_URL environment variable is required');
    console.error('   Set it to your Supabase database connection string');
    process.exit(1);
  }
  
  try {
    // Test connections
    console.log('🔗 Testing database connections...');
    await sourceClient`SELECT 1`;
    await targetClient`SELECT 1`;
    console.log('✅ Both database connections successful\n');
    
    // Migrate data in order (respecting foreign key constraints)
    const results = {
      users: await migrateUsers(),
      businessInfo: await migrateBusinessInfo(),
      calls: await migrateCalls(),
      leads: await migrateLeads(),
      documents: await migrateDocuments(),
      documentChunks: await migrateDocumentChunks(),
      conversations: await migrateElevenLabsConversations(),
    };
    
    // Verify migration
    await verifyMigration();
    
    console.log('\n📝 Migration completed!');
    console.log('   Next steps:');
    console.log('   1. Update your application to use the new DATABASE_URL');
    console.log('   2. Test your application thoroughly');
    console.log('   3. Update your deployment environment variables');
    console.log('   4. Consider keeping the old database as backup for a while');
    
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  } finally {
    await sourceClient.end();
    await targetClient.end();
  }
}

main();
