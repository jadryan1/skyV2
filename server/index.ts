// server/index.ts - Complete working server with ElevenLabs integration
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

app.get('/test', (req, res) => {
  res.json({ 
    status: 'Server is working',
    timestamp: new Date().toISOString()
  });
});

// Simple Twilio webhook (works with ElevenLabs)
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

      // Database operations
      try {
        const { db } = await import('./db.js');
        const { calls } = await import('@shared/schema');
        const { eq } = await import('drizzle-orm');

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

        let userId = null;
        if (To === '+16156565526' || From === '+16156565526') {
          userId = 3;
        }
        
        if (userId) {
          const existingCall = await db.select()
            .from(calls)
            .where(eq(calls.twilioCallSid, CallSid))
            .limit(1);

          if (existingCall.length > 0) {
            await db.update(calls)
              .set({
                status: dbStatus,
                duration: callDuration,
                endTime: EndTime ? new Date(EndTime) : null
              })
              .where(eq(calls.id, existingCall[0].id));
            
            console.log(`✅ Updated call ${existingCall[0].id} for user ${userId}`);
          } else {
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
        }
      } catch (dbError) {
        console.error('Database operation failed:', dbError);
      }

      // Simple response - no recording needed since ElevenLabs handles it
      res.type('text/xml');
      res.send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
      
    } catch (error) {
      console.error('❌ Webhook error:', error);
      res.type('text/xml');
      res.send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
    }
  }
);

// ElevenLabs conversation completion webhook
app.post('/webhooks/elevenlabs/conversation', 
  express.json(), 
  async (req, res) => {
    try {
      console.log('ElevenLabs conversation webhook received');
      console.log('Body:', JSON.stringify(req.body, null, 2));

      const {
        conversation_id,
        agent_id,
        user_id,
        phone_number,
        status,
        duration_ms,
        transcript,
        summary,
        created_at,
        metadata
      } = req.body;

      console.log('ElevenLabs conversation:', {
        conversation_id,
        phone_number,
        status,
        duration_ms,
        transcript: transcript?.length || 0,
        summary: summary?.length || 0
      });

      // Map phone number to your user
      let userId = null;
      if (phone_number === '+16156565526' || phone_number?.includes('6565526')) {
        userId = 3;
      }

      if (userId) {
        const { db } = await import('./db.js');
        const { calls } = await import('@shared/schema');
        const { eq } = await import('drizzle-orm');

        // Check if we already have this call from Twilio
        let existingCall = null;
        if (conversation_id) {
          const existing = await db.select()
            .from(calls)
            .where(eq(calls.elevenLabsConversationId, conversation_id))
            .limit(1);
          
          if (existing.length > 0) {
            existingCall = existing[0];
          }
        }

        if (existingCall) {
          // Update existing call with ElevenLabs data
          await db.update(calls)
            .set({
              transcript: transcript || null,
              summary: summary || null,
              elevenLabsConversationId: conversation_id,
              elevenLabsAgentId: agent_id,
              isFromElevenLabs: true,
              notes: 'Enhanced with ElevenLabs conversation data'
            })
            .where(eq(calls.id, existingCall.id));
          
          console.log(`✅ Enhanced existing call ${existingCall.id} with ElevenLabs data`);
        } else {
          // Create new call record with ElevenLabs data
          const [newCall] = await db.insert(calls).values({
            userId: userId,
            phoneNumber: phone_number,
            duration: duration_ms ? Math.floor(duration_ms / 1000) : null,
            status: status === 'completed' ? 'completed' : 'failed',
            direction: 'inbound',
            transcript: transcript || null,
            summary: summary || null,
            startTime: created_at ? new Date(created_at) : new Date(),
            endTime: created_at && duration_ms ? 
              new Date(new Date(created_at).getTime() + duration_ms) : null,
            createdAt: new Date(),
            notes: 'Auto-logged from ElevenLabs conversation',
            elevenLabsConversationId: conversation_id,
            elevenLabsAgentId: agent_id,
            isFromElevenLabs: true
          }).returning();

          console.log(`✅ Created new call ${newCall.id} from ElevenLabs for user ${userId}`);
        }
        
      } else {
        console.log(`No user mapping found for phone number: ${phone_number}`);
      }

      res.status(200).json({ success: true, message: 'Conversation processed' });

    } catch (error) {
      console.error('ElevenLabs webhook error:', error);
      res.status(500).json({ error: 'Processing failed' });
    }
  }
);

// GET handlers for webhook testing
app.get('/webhooks/elevenlabs/conversation', (req, res) => {
  res.json({ 
    message: 'ElevenLabs webhook endpoint is ready',
    method: 'POST required',
    timestamp: new Date().toISOString()
  });
});

app.get('/webhooks/twilio/call-status', (req, res) => {
  res.json({ 
    message: 'Twilio webhook endpoint is ready', 
    method: 'POST required',
    timestamp: new Date().toISOString()
  });
});

// API Routes
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
    
    console.log(`Retrieved ${result.length} calls for user ${userId} (${result.filter(c => c.isFromElevenLabs).length} from ElevenLabs)`);
    
    res.json({ 
      message: 'Calls retrieved successfully', 
      data: result,
      totalCount,
      limit,
      offset,
      hasMore: offset + result.length < totalCount
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

// Test endpoint to add sample calls
app.post('/api/test/add-call/:userId', async (req, res) => {
  try {
    const { db } = await import('./db.js');
    const { calls } = await import('@shared/schema');
    
    const userId = parseInt(req.params.userId);
    if (isNaN(userId)) {
      return res.status(400).json({ message: 'Invalid user ID' });
    }

    const testCall = {
      userId: userId,
      phoneNumber: '+1234567890',
      contactName: 'Test Contact',
      duration: 120,
      status: 'completed',
      direction: 'inbound',
      startTime: new Date(),
      endTime: new Date(Date.now() + 120000),
      createdAt: new Date(),
      notes: 'Test call added via API endpoint',
      summary: 'Customer inquiry about services',
      transcript: 'Hello, I am calling to inquire about your services. Thank you for your time.',
      twilioCallSid: `test_call_${Date.now()}`,
      isFromTwilio: false
    };

    const [newCall] = await db.insert(calls).values(testCall).returning();
    
    console.log(`✅ Test call created: ${newCall.id} for user ${userId}`);
    
    res.status(201).json({
      message: 'Test call added successfully',
      data: newCall
    });
    
  } catch (error) {
    console.error('Error creating test call:', error);
    res.status(500).json({ 
      message: 'Failed to create test call',
      error: error.message 
    });
  }
});

// Test ElevenLabs webhook endpoint
app.post('/api/test/elevenlabs-call/:userId', async (req, res) => {
  try {
    const userId = parseInt(req.params.userId);
    
    // Simulate ElevenLabs webhook data
    const mockElevenLabsData = {
      conversation_id: `conv_test_${Date.now()}`,
      agent_id: 'agent_test_123',
      user_id: `user_${userId}`,
      phone_number: '+16156565526',
      status: 'completed',
      duration_ms: 45000,
      transcript: 'Customer: Hello, I am interested in your services. Agent: Thank you for calling! I would be happy to help you learn more about what we offer. How can I assist you today?',
      summary: 'Customer called inquiring about services. Positive interaction, customer expressed interest.',
      created_at: new Date().toISOString(),
      metadata: { quality_score: 0.95, sentiment: 'positive' }
    };

    // Trigger the ElevenLabs webhook handler
    const response = await fetch(`${req.protocol}://${req.get('host')}/webhooks/elevenlabs/conversation`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(mockElevenLabsData)
    });

    res.json({
      message: 'Test ElevenLabs call created',
      mockData: mockElevenLabsData,
      webhookResponse: response.status
    });

  } catch (error) {
    console.error('Error creating test ElevenLabs call:', error);
    res.status(500).json({ error: error.message });
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
  console.log(`📞 Twilio: https://aidash-upga.onrender.com/webhooks/twilio/call-status`);
  console.log(`🎙️ ElevenLabs: https://aidash-upga.onrender.com/webhooks/elevenlabs/conversation`);
});

server.on('error', (error) => {
  console.error('❌ Server error:', error);
});
