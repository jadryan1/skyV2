// Add these endpoints for real-time transcription

// Real-time transcription using WebSocket streaming (alternative approach)
app.post('/webhooks/twilio/stream-transcription', 
  express.urlencoded({ extended: false }), 
  async (req, res) => {
    try {
      const { CallSid, CallStatus } = req.body;
      
      if (CallStatus === 'ringing' || CallStatus === 'answered') {
        // Use Twilio Media Streams for real-time audio
        res.type('text/xml');
        res.send(`<?xml version="1.0" encoding="UTF-8"?>
          <Response>
            <Connect>
              <Stream url="wss://aidash-upga.onrender.com/ws/transcribe/${CallSid}" />
            </Connect>
            <Record 
              recordingStatusCallback="https://aidash-upga.onrender.com/webhooks/twilio/recording"
              transcribe="false"
              maxLength="1800"
              playBeep="false"
            />
          </Response>`);
      } else {
        res.type('text/xml');
        res.send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
      }
      
    } catch (error) {
      console.error('Stream transcription error:', error);
      res.status(200).send('OK');
    }
  }
);

// Enhanced recording webhook with instant AI processing
app.post('/webhooks/twilio/recording', 
  express.urlencoded({ extended: false }), 
  async (req, res) => {
    try {
      const { CallSid, RecordingUrl, RecordingSid, RecordingDuration } = req.body;
      
      console.log('Recording completed, starting instant transcription:', { 
        CallSid, 
        RecordingUrl, 
        Duration: RecordingDuration 
      });
      
      const { db } = await import('./db.js');
      const { calls } = await import('@shared/schema');
      const { eq } = await import('drizzle-orm');
      
      // Update call with recording info
      await db.update(calls)
        .set({ 
          recordingUrl: RecordingUrl,
          recordingSid: RecordingSid,
          recordingDuration: RecordingDuration ? parseInt(RecordingDuration) : null,
          transcriptionStatus: 'processing'
        })
        .where(eq(calls.twilioCallSid, CallSid));
      
      // Trigger instant transcription in background
      processInstantTranscription(CallSid, RecordingUrl);
      
      res.type('text/xml');
      res.send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
    } catch (error) {
      console.error('Recording webhook error:', error);
      res.status(200).send('OK');
    }
  }
);

// Instant transcription processor using OpenAI Whisper API
async function processInstantTranscription(callSid: string, recordingUrl: string) {
  try {
    console.log(`Starting instant transcription for ${callSid}`);
    
    // Download the recording
    const audioResponse = await fetch(recordingUrl);
    if (!audioResponse.ok) {
      throw new Error(`Failed to download recording: ${audioResponse.status}`);
    }
    
    const audioBuffer = await audioResponse.arrayBuffer();
    
    // Convert to proper audio format for Whisper
    const formData = new FormData();
    formData.append('file', new Blob([audioBuffer], { type: 'audio/wav' }), 'recording.wav');
    formData.append('model', 'whisper-1');
    formData.append('language', 'en');
    formData.append('response_format', 'text');
    
    // Send to OpenAI Whisper API for instant transcription
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
    console.log(`Instant transcription completed for ${callSid}: ${transcriptionText.length} characters`);
    
    // Generate instant AI summary
    const summary = await generateInstantAISummary(transcriptionText);
    
    // Update database immediately
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
    
    console.log(`Instant transcription and summary saved for ${callSid}`);
    
    // Broadcast real-time update to dashboard
    // You can add WebSocket broadcast here if needed
    
  } catch (error) {
    console.error('Instant transcription failed:', error);
    
    // Update status to failed
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

// Enhanced AI summary generator using cheapest OpenAI model
async function generateInstantAISummary(transcript: string): Promise<string> {
  try {
    if (!transcript || transcript.length < 10) {
      return 'Call too short to generate meaningful summary';
    }
    
    const prompt = `Analyze this business call transcript and provide a concise summary including:
- Purpose of the call
- Key points discussed
- Customer needs or requests
- Next actions required
- Overall sentiment

Transcript: "${transcript}"

Provide a professional summary in 2-3 sentences:`;

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini', // Cheapest model at ~$0.00015 per 1K tokens
        messages: [
          { role: 'system', content: 'You are an expert at analyzing business call transcripts and creating concise, actionable summaries.' },
          { role: 'user', content: prompt }
        ],
        max_tokens: 150, // Reduced to save costs
        temperature: 0.1 // Lower for more consistent, focused summaries
      })
    });

    if (!response.ok) {
      throw new Error(`OpenAI API failed: ${response.status}`);
    }

    const data = await response.json();
    const summary = data.choices[0]?.message?.content?.trim();
    
    return summary || 'AI summary generation failed';
    
  } catch (error) {
    console.error('AI summary generation failed:', error);
    
    // Fallback to keyword-based summary
    return generateBasicSummary(transcript);
  }
}

// Fallback basic summary generator
function generateBasicSummary(transcript: string): string {
  const words = transcript.toLowerCase();
  let summary = '';
  
  if (words.includes('appointment') || words.includes('schedule')) {
    summary += 'Scheduling appointment. ';
  }
  if (words.includes('price') || words.includes('cost') || words.includes('quote')) {
    summary += 'Pricing inquiry. ';
  }
  if (words.includes('service') || words.includes('help')) {
    summary += 'Service request. ';
  }
  if (words.includes('complaint') || words.includes('problem')) {
    summary += 'Customer issue reported. ';
  }
  if (words.includes('thank')) {
    summary += 'Positive interaction. ';
  }
  
  return summary || 'General business inquiry';
}

// API endpoint to manually trigger transcription for old calls
app.post('/api/calls/:callId/transcribe', async (req, res) => {
  try {
    const { db } = await import('./db.js');
    const { calls } = await import('@shared/schema');
    const { eq } = await import('drizzle-orm');
    
    const callId = parseInt(req.params.callId);
    const userId = parseInt(req.body.userId);
    
    // Security check
    const call = await db.select()
      .from(calls)
      .where(eq(calls.id, callId))
      .limit(1);
    
    if (call.length === 0 || call[0].userId !== userId) {
      return res.status(404).json({ message: 'Call not found or access denied' });
    }
    
    const callData = call[0];
    
    if (!callData.recordingUrl) {
      return res.status(400).json({ message: 'No recording available for this call' });
    }
    
    // Trigger instant transcription
    processInstantTranscription(callData.twilioCallSid, callData.recordingUrl);
    
    res.json({ 
      message: 'Transcription started',
      estimatedTime: '30-60 seconds'
    });
    
  } catch (error) {
    console.error('Manual transcription trigger failed:', error);
    res.status(500).json({ message: 'Failed to start transcription' });
  }
});

// Status check endpoint that includes transcription progress
app.get('/api/calls/:callId/status', async (req, res) => {
  try {
    const { db } = await import('./db.js');
    const { calls } = await import('@shared/schema');
    const { eq } = await import('drizzle-orm');
    
    const callId = parseInt(req.params.callId);
    
    const call = await db.select()
      .from(calls)
      .where(eq(calls.id, callId))
      .limit(1);
    
    if (call.length === 0) {
      return res.status(404).json({ message: 'Call not found' });
    }
    
    const callData = call[0];
    
    res.json({
      id: callData.id,
      transcriptionStatus: callData.transcriptionStatus || 'not_started',
      hasRecording: !!callData.recordingUrl,
      hasTranscript: !!callData.transcript,
      hasSummary: !!callData.summary,
      completedAt: callData.transcriptionCompletedAt
    });
    
  } catch (error) {
    res.status(500).json({ message: 'Failed to check status' });
  }
});
