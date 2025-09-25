# Supabase Setup Guide for SkyIQ

This guide will help you migrate from Neon to Supabase for your SkyIQ project.

## 🚀 Quick Setup

### 1. Create Supabase Project

1. Go to [supabase.com](https://supabase.com)
2. Sign up/Login and create a new project
3. Choose a region close to your users
4. Set a strong database password
5. Wait for the project to be provisioned

### 2. Get Your Supabase Credentials

From your Supabase dashboard:

1. Go to **Settings** → **API**
2. Copy the following values:
   - **Project URL** (`SUPABASE_URL`)
   - **Anon Key** (`SUPABASE_ANON_KEY`)
   - **Service Role Key** (`SUPABASE_SERVICE_ROLE_KEY`)

3. Go to **Settings** → **Database**
4. Copy the **Connection String** (use the `postgresql://` one)

### 3. Update Environment Variables

Create/update your `.env` file:

```bash
# Supabase Configuration
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_ANON_KEY=your_anon_key_here
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key_here

# Database URL (Supabase PostgreSQL)
DATABASE_URL=postgresql://postgres:[YOUR-PASSWORD]@db.[YOUR-PROJECT-REF].supabase.co:5432/postgres

# Keep your existing variables
TWILIO_ACCOUNT_SID=your_twilio_account_sid
TWILIO_AUTH_TOKEN=your_twilio_auth_token
# ... etc
```

### 4. Install Dependencies

```bash
npm install
```

### 5. Run Database Migration

```bash
# Push schema to Supabase
npm run db:push

# Or run the migration script
node migrate-to-supabase.js
```

## 📊 Database Schema

Your Supabase database will include these tables:

### Core Tables
- **`users`** - User accounts and authentication
- **`calls`** - Call logs and transcripts
- **`leads`** - Lead management
- **`business_info`** - Business profiles and settings

### AI/ML Tables
- **`documents`** - Uploaded files and web content
- **`document_chunks`** - Processed text chunks for RAG
- **`search_queries`** - Search analytics
- **`eleven_labs_conversations`** - AI conversation logs

## 🔒 Security Features

### Row Level Security (RLS)
- All tables have RLS enabled
- Users can only access their own data
- Policies automatically filter by `user_id`

### Authentication
- Supabase handles user authentication
- JWT tokens for API access
- Secure password hashing

## 🚀 Deployment

### Environment Variables for Production

```bash
# Production Supabase
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_ANON_KEY=your_production_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_production_service_role_key
DATABASE_URL=postgresql://postgres:[PASSWORD]@db.[PROJECT-REF].supabase.co:5432/postgres
```

### Build and Deploy

```bash
# Build the project
npm run build

# Deploy (using your existing deployment script)
./build-production.sh
```

## 📈 Monitoring & Analytics

### Supabase Dashboard
- **Database** - View tables, queries, and performance
- **API** - Monitor API usage and logs
- **Auth** - User management and authentication
- **Storage** - File uploads and management

### Key Metrics to Monitor
- Database query performance
- API request volume
- User authentication success rates
- Call data storage growth

## 🔧 Troubleshooting

### Common Issues

1. **Connection Timeout**
   ```bash
   # Check your DATABASE_URL format
   postgresql://postgres:[PASSWORD]@db.[PROJECT-REF].supabase.co:5432/postgres
   ```

2. **RLS Policy Errors**
   ```sql
   -- Check if RLS is enabled
   SELECT schemaname, tablename, rowsecurity 
   FROM pg_tables 
   WHERE schemaname = 'public';
   ```

3. **Migration Issues**
   ```bash
   # Reset and re-run migrations
   npm run db:push --force
   ```

### Support
- Supabase Documentation: [supabase.com/docs](https://supabase.com/docs)
- Discord Community: [discord.supabase.com](https://discord.supabase.com)

## 🎯 Benefits of Supabase

1. **Real-time Features** - Built-in WebSocket support
2. **Authentication** - Complete auth system
3. **Storage** - File upload and management
4. **Edge Functions** - Serverless functions
5. **Dashboard** - Visual database management
6. **APIs** - Auto-generated REST and GraphQL APIs
7. **Security** - Built-in RLS and security features

## 📝 Next Steps

1. ✅ Set up Supabase project
2. ✅ Update environment variables
3. ✅ Run database migrations
4. 🔄 Test your application
5. 🔄 Migrate existing data (if needed)
6. 🔄 Deploy to production
7. 🔄 Set up monitoring and alerts

Your SkyIQ application is now ready to use Supabase as the backend database!
