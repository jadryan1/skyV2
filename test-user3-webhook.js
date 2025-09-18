
import fetch from 'node-fetch';

async function testUser3Webhook() {
  try {
    console.log('🔍 Testing user3 webhook endpoint for full transcripts...');
    console.log('📡 Testing: https://your-replit-domain.replit.dev/api/twilio/webhook/user3');
    console.log('=' .repeat(70));
    
    // Test webhook endpoint with sample Twilio data including transcript
    const testWebhookData = {
      CallSid: 'CA_TEST_TRANSCRIPT_' + Date.now(),
      From: '+15551234567',
      To: '+16155788171',
      CallStatus: 'completed',
      CallDuration: '180',
      Direction: 'inbound',
      RecordingUrl: 'https://api.twilio.com/test-recording-url',
      TranscriptionText: 'Hello, I am calling about your custom apparel services. I need 50 t-shirts for my company event next month. What are your pricing options? I also need them in blue and white colors with our company logo printed on them. Can you help me with this order?',
      TranscriptionUrl: 'https://api.twilio.com/test-transcription-url',
      TranscriptionStatus: 'completed'
    };

    console.log('📤 Sending test webhook data with full transcript...');
    console.log('📝 Test transcript:', testWebhookData.TranscriptionText);
    console.log('─'.repeat(50));

    // Send POST request to webhook
    const webhookResponse = await fetch('http://localhost:5000/api/twilio/webhook/user3', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams(testWebhookData).toString()
    });

    console.log(`📥 Webhook Response Status: ${webhookResponse.status}`);
    const webhookResponseText = await webhookResponse.text();
    console.log(`📥 Webhook Response: ${webhookResponseText}`);

    // Wait a moment for processing
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Now fetch the latest calls to see if transcript was stored
    console.log('\n🔍 Checking if transcript was stored in database...');
    const callsResponse = await fetch('http://localhost:5000/api/calls/user/3');
    
    if (!callsResponse.ok) {
      throw new Error(`HTTP ${callsResponse.status}: ${callsResponse.statusText}`);
    }
    
    const callsData = await callsResponse.json();
    const calls = callsData.data || [];
    
    console.log(`\n📊 TRANSCRIPT CHECK RESULTS:`);
    console.log(`Total calls found: ${calls.length}`);
    
    if (calls.length === 0) {
      console.log('❌ No calls found for user 3');
      return;
    }
    
    // Sort by most recent first
    const sortedCalls = calls.sort((a, b) => {
      const dateA = new Date(a.createdAt || a.date);
      const dateB = new Date(b.createdAt || b.date);
      return dateB - dateA;
    });
    
    console.log(`\n🔥 CHECKING MOST RECENT CALLS FOR TRANSCRIPTS:`);
    console.log('=' .repeat(70));
    
    let transcriptFound = false;
    let fullTranscriptFound = false;
    
    // Check first 3 calls for transcripts
    sortedCalls.slice(0, 3).forEach((call, index) => {
      const date = call.createdAt ? 
        new Date(call.createdAt).toLocaleString() : 
        `${call.date} ${call.time || ''}`;
      
      console.log(`\n📞 CALL #${index + 1} - TRANSCRIPT CHECK`);
      console.log('─'.repeat(50));
      console.log(`   Call ID: ${call.id}`);
      console.log(`   Twilio SID: ${call.twilioCallSid || 'N/A'}`);
      console.log(`   Phone: ${call.phoneNumber || call.number || 'Unknown'}`);
      console.log(`   Date: ${date}`);
      console.log(`   Source: ${call.isFromTwilio ? '🔗 Twilio Webhook' : '✍️ Manual Entry'}`);
      
      if (call.transcript) {
        transcriptFound = true;
        console.log(`   ✅ TRANSCRIPT FOUND: ${call.transcript.length} characters`);
        console.log(`   📝 Preview: "${call.transcript.substring(0, 150)}${call.transcript.length > 150 ? '...' : ''}"`);
        
        if (call.transcript.length > 100) {
          fullTranscriptFound = true;
          console.log(`   🎯 FULL TRANSCRIPT DETECTED!`);
        }
        
        // Check if this is our test transcript
        if (call.transcript.includes('custom apparel services') || call.transcript.includes('company event')) {
          console.log(`   🎉 TEST TRANSCRIPT SUCCESSFULLY STORED!`);
        }
      } else {
        console.log(`   ❌ NO TRANSCRIPT FOUND`);
      }
      
      if (call.recordingUrl) {
        console.log(`   🎵 Recording URL: ${call.recordingUrl.substring(0, 50)}...`);
      }
      
      console.log('   ' + '─'.repeat(50));
    });
    
    // Summary
    console.log(`\n📈 TRANSCRIPT ANALYSIS SUMMARY:`);
    console.log(`═`.repeat(50));
    console.log(`   Calls with transcripts: ${sortedCalls.filter(c => c.transcript).length}/${calls.length}`);
    console.log(`   Transcript found in recent calls: ${transcriptFound ? '✅ YES' : '❌ NO'}`);
    console.log(`   Full transcripts detected: ${fullTranscriptFound ? '✅ YES' : '❌ NO'}`);
    
    const avgTranscriptLength = sortedCalls
      .filter(c => c.transcript)
      .reduce((sum, c) => sum + c.transcript.length, 0) / Math.max(1, sortedCalls.filter(c => c.transcript).length);
    
    console.log(`   Average transcript length: ${Math.round(avgTranscriptLength)} characters`);
    
    // Check webhook endpoint availability
    console.log(`\n🔗 WEBHOOK ENDPOINT STATUS:`);
    console.log(`   Endpoint: https://your-replit-domain.replit.dev/api/twilio/webhook/user3`);
    console.log(`   Local test: ${webhookResponse.status === 200 ? '✅ WORKING' : '❌ FAILED'}`);
    console.log(`   Response: ${webhookResponseText}`);
    
    if (transcriptFound && fullTranscriptFound) {
      console.log(`\n🎉 SUCCESS: Full transcripts are being captured and stored!`);
    } else if (transcriptFound) {
      console.log(`\n⚠️  PARTIAL: Transcripts found but may be incomplete`);
    } else {
      console.log(`\n❌ ISSUE: No transcripts found - check Twilio webhook configuration`);
    }
    
  } catch (error) {
    console.error('❌ Error testing user3 webhook:', error.message);
    console.error('Stack:', error.stack);
  }
}

testUser3Webhook();
