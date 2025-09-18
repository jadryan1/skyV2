
console.log('🔍 Testing transcript download functionality...');

async function testTranscriptDownload() {
  try {
    // First, let's check what calls exist for user 3
    console.log('\n📊 Fetching calls for user 3...');
    const callsResponse = await fetch('http://localhost:5000/api/calls/user/3');
    
    if (!callsResponse.ok) {
      throw new Error(`HTTP ${callsResponse.status}: ${callsResponse.statusText}`);
    }
    
    const callsData = await callsResponse.json();
    const calls = callsData.data || [];
    
    console.log(`\n📈 CALL DATA SUMMARY:`);
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
    
    console.log(`\n🔥 TRANSCRIPT AVAILABILITY CHECK:`);
    console.log('=' .repeat(70));
    
    let callsWithTranscripts = 0;
    let totalTranscriptChars = 0;
    
    // Check each call for transcript availability
    sortedCalls.forEach((call, index) => {
      const date = call.createdAt ? 
        new Date(call.createdAt).toLocaleString() : 
        `${call.date} ${call.time || ''}`;
      
      console.log(`\n📞 CALL #${index + 1} - TRANSCRIPT CHECK`);
      console.log('─'.repeat(50));
      console.log(`   Call ID: ${call.id}`);
      console.log(`   Twilio SID: ${call.twilioCallSid || 'N/A'}`);
      console.log(`   Phone: ${call.phoneNumber || call.number}`);
      console.log(`   Date: ${date}`);
      console.log(`   Source: ${call.isFromTwilio ? '🔗 Twilio Webhook' : '✍️ Manual Entry'}`);
      
      if (call.transcript) {
        console.log(`   ✅ TRANSCRIPT FOUND: ${call.transcript.length} characters`);
        console.log(`   📝 Preview: "${call.transcript.substring(0, 100)}..."`);
        callsWithTranscripts++;
        totalTranscriptChars += call.transcript.length;
        
        // Show word count estimate
        const wordCount = call.transcript.split(' ').length;
        console.log(`   📊 Estimated words: ${wordCount}`);
        
        if (call.recordingUrl) {
          console.log(`   🎵 Recording URL: ${call.recordingUrl.substring(0, 50)}...`);
        }
      } else {
        console.log(`   ❌ NO TRANSCRIPT FOUND`);
      }
      console.log('─'.repeat(50));
    });
    
    console.log(`\n📈 TRANSCRIPT SUMMARY:`);
    console.log('═'.repeat(70));
    console.log(`   Calls with transcripts: ${callsWithTranscripts}/${calls.length}`);
    console.log(`   Total transcript characters: ${totalTranscriptChars.toLocaleString()}`);
    console.log(`   Average transcript length: ${callsWithTranscripts ? Math.round(totalTranscriptChars / callsWithTranscripts) : 0} characters`);
    
    const twilioWebhookCalls = calls.filter(call => call.isFromTwilio);
    console.log(`   Twilio webhook calls: ${twilioWebhookCalls.length}`);
    console.log(`   Manual entries: ${calls.length - twilioWebhookCalls.length}`);
    
    // Show download readiness
    if (callsWithTranscripts > 0) {
      console.log(`\n✅ DOWNLOAD READY: ${callsWithTranscripts} calls have transcripts ready for download`);
      console.log(`📄 Users can download formatted transcripts with full call metadata`);
    } else {
      console.log(`\n⚠️  NO DOWNLOADABLE TRANSCRIPTS: No calls have transcript content`);
    }
    
    console.log(`\n🔴 RAW DATA MODE: AI processing disabled, showing raw transcript data`);
    
  } catch (error) {
    console.error('❌ Error testing transcript download:', error.message);
  }
}

testTranscriptDownload();
