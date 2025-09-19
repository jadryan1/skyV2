// Add these endpoints to your server/index.ts

// Enhanced Twilio webhook with caller notification and transcription
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

      console.log('Call Event:', {
        CallSid,
        CallStatus,
        From,
        To,
        Direction,
        Duration: Duration || CallDuration
      });

      // Handle database operations (existing code)
      const { db } = await import('./db.js');
      const { calls } = await import('@shared/schema');
      const { eq, desc } = await import('drizzle-orm');

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
          
          console.log(`Updated call ${existingCall[0].id} for user ${userId}`);
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
          
          console.log(`Created call ${newCall.id} for user ${userId}`);
        }
      }

      // Handle TwiML response based on call status
      if (CallStatus === 'ringing' || CallStatus === 'answered') {
        // For incoming calls, start silent recording with transcription
        res.type('text/xml');
        res.send(`<?xml version="1.0" encoding="UTF-8"?>
          <Response>
            <Record 
              recordingStatusCallback="https://aidash-upga.onrender.com/webhooks/twilio/recording"
              transcribe="true"
              transcribeCallback="https://aidash-upga.onrender.com/webhooks/twilio/transcription"
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
      console.error('Webhook error:', error);
      res.type('text/xml');
      res.send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
    }
  }
);

// Recording completion webhook
app.post('/webhooks/twilio/recording', 
  express.urlencoded({ extended: false }), 
  async (req, res) => {
    try {
      const { CallSid, RecordingUrl, RecordingSid, RecordingDuration } = req.body;
      
      console.log('Recording completed:', { 
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
      
      console.log(`Recording saved for CallSid: ${CallSid}`);
      
      res.type('text/xml');
      res.send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
    } catch (error) {
      console.error('Recording webhook error:', error);
      res.status(200).send('OK');
    }
  }
);

// Transcription completion webhook
app.post('/webhooks/twilio/transcription', 
  express.urlencoded({ extended: false }), 
  async (req, res) => {
    try {
      const { CallSid, TranscriptionText, TranscriptionUrl, TranscriptionStatus } = req.body;
      
      console.log('Transcription completed:', { 
        CallSid, 
        Status: TranscriptionStatus,
        TextLength: TranscriptionText ? TranscriptionText.length : 0
      });
      
      const { db } = await import('./db.js');
      const { calls } = await import('@shared/schema');
      const { eq } = await import('drizzle-orm');
      
      // Update call record with transcript
      await db.update(calls)
        .set({ 
          transcript: TranscriptionText || 'Transcription failed or unavailable',
          transcriptionUrl: TranscriptionUrl,
          transcriptionStatus: TranscriptionStatus === 'completed' ? 'completed' : 'failed',
          transcriptionCompletedAt: new Date()
        })
        .where(eq(calls.twilioCallSid, CallSid));
      
      console.log(`Transcription saved for CallSid: ${CallSid}`);
      
      // Generate AI summary if transcript is available
      if (TranscriptionText && TranscriptionText.length > 10) {
        try {
          const summary = await generateCallSummary(TranscriptionText);
          await db.update(calls)
            .set({ summary })
            .where(eq(calls.twilioCallSid, CallSid));
          
          console.log(`AI summary generated for CallSid: ${CallSid}`);
        } catch (summaryError) {
          console.error('Summary generation failed:', summaryError);
        }
      }
      
      res.type('text/xml');
      res.send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
    } catch (error) {
      console.error('Transcription webhook error:', error);
      res.status(200).send('OK');
    }
  }
);

// Download transcript as TXT file
app.get('/api/calls/:callId/transcript.txt', async (req, res) => {
  try {
    const { db } = await import('./db.js');
    const { calls } = await import('@shared/schema');
    const { eq } = await import('drizzle-orm');
    
    const callId = parseInt(req.params.callId);
    const userId = parseInt(req.query.userId as string);
    
    if (!userId) {
      return res.status(400).json({ message: 'User ID required' });
    }
    
    // Get call with security check
    const call = await db.select()
      .from(calls)
      .where(eq(calls.id, callId))
      .limit(1);
    
    if (call.length === 0) {
      return res.status(404).json({ message: 'Call not found' });
    }
    
    if (call[0].userId !== userId) {
      return res.status(403).json({ message: 'Access denied' });
    }
    
    const callData = call[0];
    
    // Generate transcript content
    const transcriptContent = `
CALL TRANSCRIPT
===============

Business: ${callData.businessName || 'Unknown'}
Contact: ${callData.phoneNumber}
Date: ${callData.createdAt ? new Date(callData.createdAt).toLocaleDateString() : 'Unknown'}
Time: ${callData.createdAt ? new Date(callData.createdAt).toLocaleTimeString() : 'Unknown'}
Duration: ${callData.duration ? Math.floor(callData.duration / 60) + 'm ' + (callData.duration % 60) + 's' : 'Unknown'}
Direction: ${callData.direction?.toUpperCase() || 'Unknown'}
Status: ${callData.status?.toUpperCase() || 'Unknown'}

SUMMARY:
${callData.summary || 'No summary available'}

NOTES:
${callData.notes || 'No notes available'}

TRANSCRIPTION STATUS: ${callData.transcriptionStatus?.toUpperCase() || 'NOT_AVAILABLE'}

FULL TRANSCRIPT:
${callData.transcript || 'Transcript not available. This could be because:\n- Call was too short to transcribe\n- Transcription is still processing\n- Recording failed\n- Transcription service encountered an error'}

---
Generated: ${new Date().toLocaleString()}
Source: ${callData.isFromTwilio ? 'Automatically Captured via Twilio' : 'Manually Entered'}
Call ID: ${callData.twilioCallSid || callData.id}
`.trim();

    // Set headers for file download
    res.setHeader('Content-Type', 'text/plain');
    res.setHeader('Content-Disposition', `attachment; filename="transcript_${callData.phoneNumber}_${new Date(callData.createdAt || new Date()).toISOString().split('T')[0]}.txt"`);
    
    res.send(transcriptContent);
    
  } catch (error) {
    console.error('Transcript download error:', error);
    res.status(500).json({ message: 'Failed to generate transcript' });
  }
});

// Check transcription status for all pending calls
app.get('/api/calls/check-transcriptions/:userId', async (req, res) => {
  try {
    const { db } = await import('./db.js');
    const { calls } = await import('@shared/schema');
    const { eq, and, or, isNull } = await import('drizzle-orm');
    
    const userId = parseInt(req.params.userId);
    
    // Get calls that are waiting for transcription
    const pendingCalls = await db.select()
      .from(calls)
      .where(
        and(
          eq(calls.userId, userId),
          or(
            eq(calls.transcriptionStatus, 'processing'),
            isNull(calls.transcriptionStatus)
          )
        )
      );
    
    const results = {
      pending: pendingCalls.length,
      calls: pendingCalls.map(call => ({
        id: call.id,
        phoneNumber: call.phoneNumber,
        date: call.createdAt,
        status: call.transcriptionStatus || 'unknown',
        hasRecording: !!call.recordingUrl
      }))
    };
    
    res.json(results);
    
  } catch (error) {
    console.error('Transcription check error:', error);
    res.status(500).json({ message: 'Failed to check transcriptions' });
  }
});

// Helper function to generate AI summary
async function generateCallSummary(transcript: string): Promise<string> {
  try {
    // Simple keyword-based summary for now
    const words = transcript.toLowerCase();
    
    let summary = 'Call summary: ';
    
    if (words.includes('appointment') || words.includes('schedule')) {
      summary += 'Customer scheduling appointment. ';
    }
    if (words.includes('price') || words.includes('cost') || words.includes('quote')) {
      summary += 'Pricing inquiry. ';
    }
    if (words.includes('service') || words.includes('help')) {
      summary += 'Service request. ';
    }
    if (words.includes('complaint') || words.includes('problem')) {
      summary += 'Customer complaint/issue. ';
    }
    
    if (summary === 'Call summary: ') {
      summary += 'General inquiry or conversation.';
    }
    
    return summary;
    
  } catch (error) {
    return 'Summary generation failed';
  }
}
