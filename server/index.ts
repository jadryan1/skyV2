// server/index.ts - Simple working version
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';

const app = express();
const PORT = process.env.PORT || 3000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('🚀 Starting server...');
console.log('Environment:', process.env.NODE_ENV);
console.log('Port:', PORT);

// Middleware
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    port: PORT
  });
});

// Test endpoint
app.get('/test', (req, res) => {
  res.json({ 
    status: 'Server is working',
    timestamp: new Date().toISOString()
  });
});

// Enhanced Twilio webhook with database integration
app.post('/webhooks/twilio/call-status', 
  express.urlencoded({ extended: false }), 
  async (req, res) => {
    try {
      console.log('Twilio webhook received');
      console.log('Body:', req.body);
      
      const {
        CallSid,
        CallStatus,
        From,
        To,
        Direction,
        Duration,
        CallDuration,
        StartTime,
        EndTime
      } = req.body;

      console.log('📞 Call Event:', {
        CallSid,
        CallStatus,
        From,
        To,
        Direction,
        Duration: Duration || CallDuration
      });

      // Import database components dynamically to avoid import issues
      try {
        const { db } = await import('./db.js');
        const { calls } = await import('@shared/schema');
        const { eq, desc } = await import('drizzle-orm');

        // Map Twilio status to database enum
        const mapStatus = (status: string) => {
          switch (status?.toLowerCase()) {
            case 'completed': return 'completed';
            case 'ringing':
            case 'answered': 
            case 'in-progress': return 'in-progress';
            case 'busy':
            case 'no-answer': return 'missed';
            default: return 'failed';
          }
        };

        const dbStatus = mapStatus(CallStatus);
        const callDuration = Duration ? parseInt(Duration) : (CallDuration ? parseInt(CallDuration) : null);

        // Map phone number to user (expand this for other users)
        let userId = null;
        if (To === '+16156565526' || From === '+16156565526') {
          userId = 3;
        }
        
        if (userId) {
          // Check if call already exists
          const existingCall = await db.select()
            .from(calls)
            .where(eq(calls.twilioCallSid, CallSid))
            .limit(1);

          if (existingCall.length > 0) {
            // Update existing call
            await db.update(calls)
              .set({
                status: dbStatus,
                duration: callDuration,
                endTime: EndTime ? new Date(EndTime) : null
              })
              .where(eq(calls.id, existingCall[0].id));
            
            console.log(`✅ Updated call ${existingCall[0].id} for user ${userId}`);
          } else {
            // Create new call
            const [newCall] = await db.insert(calls).values({
              userId: userId,
              twilioCallSid: CallSid,
              phoneNumber: Direction === 'inbound' ? From : To,
              duration: callDuration,
              status: dbStatus,
              direction: Direction === 'inbound' ? 'inbound' : 'outbound',
              startTime: StartTime ? new Date(StartTime) : new Date(),
              endTime: EndTime ? new Date(EndTime) : null,
              createdAt: new Date(),
              notes: `Auto-logged from Twilio webhook`,
              isFromTwilio: true
            }).returning();
            
            console.log(`✅ Created call ${newCall.id} for user ${userId}`);
          }
        } else {
          console.log(`❌ No user mapping for: ${From} → ${To}`);
        }
      } catch (dbError) {
        console.error('Database operation failed:', dbError);
      }

      res.type('text/xml');
      res.send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
      
    } catch (error) {
      console.error('❌ Webhook error:', error);
      res.type('text/xml');
      res.send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
    }
  }
);

// Basic API routes with database integration
app.post('/api/auth/login', async (req, res) => {
  try {
    const { storage } = await import('./storage.js');
    const user = await storage.validateUserCredentials(req.body);
    if (!user) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }
    const { password, ...userWithoutPassword } = user;
    res.json({ message: 'Login successful', user: userWithoutPassword });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ message: 'Login failed' });
  }
});

app.get('/api/auth/user/:id', async (req, res) => {
  try {
    const { storage } = await import('./storage.js');
    const user = await storage.getUser(parseInt(req.params.id));
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    const { password, ...userWithoutPassword } = user;
    res.json({ data: userWithoutPassword });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ message: 'Failed to fetch user' });
  }
});

app.get('/api/calls/user/:userId', async (req, res) => {
  try {
    const { db } = await import('./db.js');
    const { calls } = await import('@shared/schema');
    const { eq, desc, sql } = await import('drizzle-orm');
    
    const userId = parseInt(req.params.userId);
    const limit = parseInt(req.query.limit as string) || 20;
    const offset = parseInt(req.query.offset as string) || 0;
    
    const totalCountResult = await db.select({ count: sql<number>`count(*)` })
      .from(calls)
      .where(eq(calls.userId, userId));
    const totalCount = totalCountResult[0]?.count || 0;
    
    const result = await db.select()
      .from(calls)
      .where(eq(calls.userId, userId))
      .orderBy(desc(calls.createdAt))
      .limit(limit)
      .offset(offset);
    
    console.log(`Retrieved ${result.length} calls for user ${userId}`);
    
    res.json({ 
      message: 'Calls retrieved successfully', 
      data: result,
      totalCount,
      limit,
      offset
    });
  } catch (error) {
    console.error('Get calls error:', error);
    res.status(500).json({ message: 'Failed to fetch calls' });
  }
});

app.get('/api/business/:id', async (req, res) => {
  try {
    const { storage } = await import('./storage.js');
    const business = await storage.getBusinessInfo(parseInt(req.params.id));
    res.json({ data: business });
  } catch (error) {
    console.error('Get business error:', error);
    res.status(500).json({ message: 'Failed to fetch business' });
  }
});

app.post('/api/calls', async (req, res) => {
  try {
    const { storage } = await import('./storage.js');
    const result = await storage.createCall(req.body);
    res.status(201).json({ 
      message: 'Call created successfully', 
      data: result 
    });
  } catch (error) {
    console.error('Create call error:', error);
    res.status(500).json({ message: 'Failed to create call' });
  }
});

// Test endpoint to add sample calls to dashboard
app.post('/api/test/add-call/:userId', async (req, res) => {
  try {
    const { db } = await import('./db.js');
    const { calls } = await import('@shared/schema');
    
    const userId = parseInt(req.params.userId);
    if (isNaN(userId)) {
      return res.status(400).json({ message: 'Invalid user ID' });
    }

    // Create a test call
    const testCall = {
      userId: userId,
      phoneNumber: '+1234567890',
      contactName: 'Test Contact',
      duration: 120, // 2 minutes
      status: 'completed',
      direction: 'inbound',
      startTime: new Date(),
      endTime: new Date(Date.now() + 120000), // 2 minutes later
      createdAt: new Date(),
      notes: 'Test call added via API endpoint',
      summary: 'Customer inquiry about services',
      twilioCallSid: `test_call_${Date.now()}`,
      isFromTwilio: false
    };

    const [newCall] = await db.insert(calls).values(testCall).returning();
    
    console.log(`✅ Test call created: ${newCall.id} for user ${userId}`);
    
    res.status(201).json({
      message: 'Test call added successfully',
      data: newCall,
      instructions: 'Check your dashboard - this call should appear immediately'
    });
    
  } catch (error) {
    console.error('Error creating test call:', error);
    res.status(500).json({ 
      message: 'Failed to create test call',
      error: error.message 
    });
  }
});

// Get test endpoint for easy dashboard verification
app.get('/api/test/dashboard/:userId', async (req, res) => {
  try {
    const userId = parseInt(req.params.userId);
    
    res.json({
      message: 'Dashboard test endpoint',
      userId: userId,
      testCallUrl: `POST /api/test/add-call/${userId}`,
      dashboardUrl: `GET /api/calls/user/${userId}`,
      instructions: [
        '1. POST to /api/test/add-call/3 to add a test call',
        '2. Check your dashboard to see the new call',
        '3. Make a real call to your Twilio number to test webhook'
      ]
    });
  } catch (error) {
    res.status(500).json({ message: 'Test endpoint error' });
  }
});

// Static files
const publicPath = path.join(process.cwd(), 'dist', 'public');
app.use(express.static(publicPath, { fallthrough: true }));

// Catch-all for React Router
app.get('*', (req, res) => {
  console.log('Catch-all route for:', req.path);
  
  try {
    const indexPath = path.join(publicPath, 'index.html');
    
    if (existsSync(indexPath)) {
      res.sendFile(indexPath);
    } else {
      res.status(404).send('App not found');
    }
  } catch (error) {
    console.error('Error in catch-all route:', error);
    res.status(500).send(`Server error: ${error.message}`);
  }
});

// Error handling
app.use((error, req, res, next) => {
  console.error('❌ Express Error:', error);
  res.status(500).json({ 
    error: 'Internal server error',
    message: error.message
  });
});

// Start server
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Server started on port ${PORT}`);
  console.log(`🌐 https://aidash-upga.onrender.com`);
  console.log(`📞 Webhook: https://aidash-upga.onrender.com/webhooks/twilio/call-status`);
});

server.on('error', (error) => {
  console.error('❌ Server error:', error);
});
