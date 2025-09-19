// Add ElevenLabs webhook integration to your server

// ElevenLabs conversation completion webhook
app.post('/webhooks/elevenlabs/conversation', 
  express.json(), 
  async (req, res) => {
    try {
      console.log('ElevenLabs conversation webhook received');
      console.log('Body:', JSON.stringify(req.body, null, 2));

      // Validate ElevenLabs signature if you have auth token
      const isValid = process.env.NODE_ENV === 'development' || 
                     validateElevenLabsSignature(req, process.env.ELEVENLABS_WEBHOOK_SECRET || '');
      
      if (!isValid) {
        console.error('Invalid ElevenLabs signature');
        return res.status(403).json({ error: 'Invalid signature' });
      }

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

      // Map phone number to your user (expand this logic)
      let userId = null;
      if (phone_number === '+16156565526') {
        userId = 3;
      }
      // Add more phone number mappings here for other users

      if (userId) {
        const { db } = await import('./db.js');
        const { calls } = await import('@shared/schema');

        // Create call record with ElevenLabs data
        const [newCall] = await db.insert(calls).values({
          userId: userId,
          phoneNumber: phone_number,
          duration: duration_ms ? Math.floor(duration_ms / 1000) : null,
          status: status === 'completed' ? 'completed' : 'failed',
          direction: 'inbound', // ElevenLabs typically handles inbound
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

        console.log(`✅ ElevenLabs conversation saved as call ${newCall.id} for user ${userId}`);

        // Broadcast real-time update if you have WebSocket
        // wsManager.broadcastToUser(userId, { type: 'call_update', call: newCall });
        
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

// ElevenLabs agent performance webhook (optional)
app.post('/webhooks/elevenlabs/agent-performance', 
  express.json(), 
  async (req, res) => {
    try {
      const { agent_id, metrics, timestamp } = req.body;
      
      console.log('ElevenLabs agent performance:', {
        agent_id,
        metrics,
        timestamp
      });

      // Store agent performance data if needed
      // This could include response time, conversation success rate, etc.
      
      res.status(200).json({ success: true });
    } catch (error) {
      console.error('ElevenLabs performance webhook error:', error);
      res.status(200).send('OK');
    }
  }
);

// API endpoint to get ElevenLabs conversation details
app.get('/api/elevenlabs/conversation/:conversationId', async (req, res) => {
  try {
    const conversationId = req.params.conversationId;
    
    // Fetch from ElevenLabs API
    const response = await fetch(`https://api.elevenlabs.io/v1/convai/conversations/${conversationId}`, {
      headers: {
        'xi-api-key': process.env.ELEVENLABS_API_KEY || '',
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      return res.status(response.status).json({ 
        error: 'Failed to fetch conversation from ElevenLabs' 
      });
    }

    const conversationData = await response.json();
    
    res.json({
      conversation: conversationData,
      transcript: conversationData.transcript,
      summary: conversationData.summary,
      duration: conversationData.duration_ms,
      status: conversationData.status
    });

  } catch (error) {
    console.error('Error fetching ElevenLabs conversation:', error);
    res.status(500).json({ error: 'Failed to fetch conversation' });
  }
});

// Enhanced calls endpoint that includes ElevenLabs data
app.get('/api/calls/user/:userId/enhanced', async (req, res) => {
  try {
    const { db } = await import('./db.js');
    const { calls } = await import('@shared/schema');
    const { eq, desc, sql } = await import('drizzle-orm');
    
    const userId = parseInt(req.params.userId);
    const limit = parseInt(req.query.limit as string) || 20;
    const offset = parseInt(req.query.offset as string) || 0;
    
    const result = await db.select()
      .from(calls)
      .where(eq(calls.userId, userId))
      .orderBy(desc(calls.createdAt))
      .limit(limit)
      .offset(offset);
    
    // Enhance with ElevenLabs data for calls that have conversation IDs
    const enhancedCalls = await Promise.all(
      result.map(async (call) => {
        if (call.elevenLabsConversationId && process.env.ELEVENLABS_API_KEY) {
          try {
            const response = await fetch(
              `https://api.elevenlabs.io/v1/convai/conversations/${call.elevenLabsConversationId}`,
              {
                headers: {
                  'xi-api-key': process.env.ELEVENLABS_API_KEY,
                  'Content-Type': 'application/json'
                }
              }
            );
            
            if (response.ok) {
              const elevenLabsData = await response.json();
              return {
                ...call,
                elevenLabsMetadata: {
                  agent_response_time: elevenLabsData.agent_response_time,
                  conversation_quality_score: elevenLabsData.quality_score,
                  interruptions: elevenLabsData.interruptions,
                  sentiment: elevenLabsData.sentiment
                }
              };
            }
          } catch (error) {
            console.error(`Failed to enhance call ${call.id} with ElevenLabs data:`, error);
          }
        }
        return call;
      })
    );
    
    res.json({ 
      message: 'Enhanced calls retrieved successfully', 
      data: enhancedCalls,
      totalCount: result.length
    });
    
  } catch (error) {
    console.error('Enhanced calls fetch error:', error);
    res.status(500).json({ message: 'Failed to fetch enhanced calls' });
  }
});

// Simplified webhook for Twilio that works with ElevenLabs
app.post('/webhooks/twilio/simple-status', 
  express.urlencoded({ extended: false }), 
  async (req, res) => {
    try {
      const { CallSid, CallStatus, From, To, Direction, Duration } = req.body;
      
      console.log('Simple Twilio status for ElevenLabs integration:', {
        CallSid, CallStatus, From, To, Direction, Duration
      });

      // Only log basic call info - let ElevenLabs handle transcription/recording
      if (CallStatus === 'completed') {
        const userId = (To === '+16156565526' || From === '+16156565526') ? 3 : null;
        
        if (userId) {
          const { db } = await import('./db.js');
          const { calls } = await import('@shared/schema');
          const { eq } = await import('drizzle-orm');
          
          // Check if ElevenLabs already created this call
          const existingCall = await db.select()
            .from(calls)
            .where(eq(calls.twilioCallSid, CallSid))
            .limit(1);
          
          if (existingCall.length === 0) {
            // Create basic call record - ElevenLabs will enhance it
            await db.insert(calls).values({
              userId: userId,
              twilioCallSid: CallSid,
              phoneNumber: Direction === 'inbound' ? From : To,
              duration: Duration ? parseInt(Duration) : null,
              status: 'completed',
              direction: Direction === 'inbound' ? 'inbound' : 'outbound',
              createdAt: new Date(),
              notes: 'Basic Twilio log - Enhanced by ElevenLabs',
              isFromTwilio: true
            });
            
            console.log(`Basic call logged for ${CallSid}, awaiting ElevenLabs enhancement`);
          }
        }
      }
      
      res.type('text/xml');
      res.send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
      
    } catch (error) {
      console.error('Simple Twilio webhook error:', error);
      res.status(200).send('OK');
    }
  }
);
