// server/index.ts - Complete working server with transcription
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

// Enhanced Twilio webhook with silent recording
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

      // TwiML response for recording
      if (CallStatus === 'ringing' || CallStatus === 'answered') {
        res.type('text/xml');
        res.send(`<?xml version="1.0" encoding="UTF-8"?>
          <Response>
            <Record 
              recordingStatusCallback="https://aidash-upga.onrender.com/webhooks/twilio/recording"
              transcribe="false"
              maxLength="1800"
              playBeep="false"
              finishOnKey="#"
            />
          </Response>`);
      } else {
        res.type('text/xml');
        res.send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
      }
      
    } catch (error) {
      console.error('❌ Webhook error:', error);
      res.type('text/xml');
      res.send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
    }
  }
);

// Recording completion webhook with instant transcription
app.post('/webhooks/twilio/recording', 
  express.urlencoded({ extended: false }), 
  async (req, res) => {
    try {
      const { CallSid, RecordingUrl, RecordingSid, RecordingDuration } = req.body;
      
      console.log('📹 Recording completed:', { 
        CallSid, 
        RecordingUrl, 
        Duration: RecordingDuration 
      });
      
      const { db } = await import('./db.js');
      const { calls } = await import('@shared/schema');
      const { eq } = await import('drizzle-orm');
      
      await db.update(calls)
        .set({ 
          recordingUrl: RecordingUrl,
          recordingSid: RecordingSid,
          recordingDuration: RecordingDuration ? parseInt(RecordingDuration) : null,
          transcriptionStatus: 'processing'
        })
        .where(eq(calls.twilioCallSid, CallSid));
      
      console.log(`💾 Recording saved for ${CallSid}, starting transcription...`);
      
      // Trigger instant transcription
      processInstantTranscription(CallSid, RecordingUrl);
      
      res.type('text/xml');
      res.send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
    } catch (error) {
      console.error('❌ Recording webhook error:', error);
      res.status(200).send('OK');
    }
  }
);

// Instant transcription processor
async function processInstantTranscription(callSid: string, recordingUrl: string) {
  try {
    console.log(`🎯 Starting instant transcription for ${callSid}`);
    
    // Download the recording
    const audioResponse = await fetch(recordingUrl);
    if (!audioResponse.ok) {
      throw new Error(`Failed to download recording: ${audioResponse.status}`);
    }
    
    const audioBuffer = await audioResponse.arrayBuffer();
    
    // Prepare for Whisper API
    const formData = new FormData();
    formData.append('file', new Blob([audioBuffer], { type: 'audio/wav' }), 'recording.wav');
    formData.append('model', 'whisper-1');
    formData.append('language', 'en');
    formData.append('response_format', 'text');
    
    // Send to OpenAI Whisper
    const transcriptionResponse = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: formData
    });
    
    if (!transcriptionResponse.ok) {
      throw new Error(`Whisper API failed: ${transcriptionResponse.status}`);
    }
    
    const transcriptionText = await transcriptionResponse.text();
    console.log(`✅ Transcription completed: ${transcriptionText.length} characters`);
    
    // Generate AI summary
    const summary = await generateAISummary(transcriptionText);
    
    // Update database
    const { db } = await import('./db.js');
    const { calls } = await import('@shared/schema');
    const { eq } = await import('drizzle-orm');
    
    await db.update(calls)
      .set({ 
        transcript: transcriptionText,
        summary: summary,
        transcriptionStatus: 'completed',
        transcriptionCompletedAt: new Date()
      })
      .where(eq(calls.twilioCallSid, callSid));
    
    console.log(`💫 Instant transcription and summary saved for ${callSid}`);
    
  } catch (error) {
    console.error('❌ Instant transcription failed:', error);
    
    try {
      const { db } = await import('./db.js');
      const { calls } = await import('@shared/schema');
      const { eq } = await import('drizzle-orm');
      
      await db.update(calls)
        .set({ 
          transcriptionStatus: 'failed',
          transcript: `Transcription failed: ${error.message}`
        })
        .where(eq(calls.twilioCallSid, callSid));
    } catch (dbError) {
      console.error('Failed to update transcription status:', dbError);
    }
  }
}

// AI summary generator using cheapest model
async function generateAISummary(transcript: string): Promise<string> {
  try {
    if (!transcript || transcript.length < 10) {
      return 'Call too short for summary';
    }
    
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: 'Analyze business calls and create concise summaries.' },
          { role: 'user', content: `Summarize this call: "${transcript}"` }
        ],
        max_tokens: 100,
        temperature: 0.1
      })
    });

    if (!response.ok) {
      throw new Error(`OpenAI API failed: ${response.status}`);
    }

    const data = await response.json();
    return data.choices[0]?.message?.content?.trim() || 'AI summary failed';
    
  } catch (error) {
    console.error('AI summary failed:', error);
    return `Basic summary: Customer call lasting ${Math.floor((transcript.length / 100))} segments`;
  }
}

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
  console.log(`🎙️ Recording: https://aidash-upga.onrender.com/webhooks/twilio/recording`);
});

server.on('error', (error) => {
  console.error('❌ Server error:', error);
});
