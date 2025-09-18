
import fetch from 'node-fetch';

async function testRawCallData() {
  try {
    console.log('🔍 Testing raw call data retrieval for user 3...');
    console.log('🚫 AI PROCESSING DISABLED - SHOWING RAW DATA ONLY');
    console.log('=' .repeat(60));
    
    const response = await fetch('http://localhost:5000/api/calls/user/3');
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const data = await response.json();
    const calls = data.data || [];
    
    console.log(`\n📊 RAW CALL DATA SUMMARY:`);
    console.log(`Total calls found: ${calls.length}`);
    
    if (calls.length === 0) {
      console.log('No calls found for user 3');
      return;
    }
    
    // Sort by most recent first
    const sortedCalls = calls.sort((a, b) => {
      const dateA = new Date(a.createdAt || a.date);
      const dateB = new Date(b.createdAt || b.date);
      return dateB - dateA;
    });
    
    console.log(`\n🔥 MOST RECENT RAW CALLS:`);
    console.log('=' .repeat(60));
    
    // Show all calls with full details
    sortedCalls.forEach((call, index) => {
      const date = call.createdAt ? 
        new Date(call.createdAt).toLocaleString() : 
        `${call.date} ${call.time || ''}`;
      
      const duration = typeof call.duration === 'number' ? 
        `${Math.floor(call.duration / 60)}m ${call.duration % 60}s` : 
        (call.duration || 'N/A');
      
      console.log(`\n📞 RAW CALL #${index + 1}`);
      console.log('─'.repeat(50));
      console.log(`   Call ID: ${call.id}`);
      console.log(`   Twilio SID: ${call.twilioCallSid || 'N/A'}`);
      console.log(`   Phone: ${call.phoneNumber || call.number || 'Unknown'}`);
      console.log(`   Contact: ${call.contactName || call.name || 'Unknown'}`);
      console.log(`   Date: ${date}`);
      console.log(`   Duration: ${duration}`);
      console.log(`   Status: ${call.status?.toUpperCase() || 'UNKNOWN'}`);
      console.log(`   Direction: ${call.direction || 'N/A'}`);
      console.log(`   Source: ${call.isFromTwilio ? '🔗 Twilio Webhook' : '✍️ Manual Entry'}`);
      
      if (call.recordingUrl) {
        console.log(`   Recording: 🎵 Available (${call.recordingUrl.substring(0, 50)}...)`);
      }
      
      if (call.transcript) {
        console.log(`   Transcript: 📝 ${call.transcript.length} characters`);
        console.log(`   Preview: "${call.transcript.substring(0, 100)}${call.transcript.length > 100 ? '...' : ''}"`);
      } else {
        console.log(`   Transcript: ❌ Not available`);
      }
      
      if (call.summary) {
        console.log(`   Summary: ${call.summary.substring(0, 150)}${call.summary.length > 150 ? '...' : ''}`);
      }
      
      if (call.notes) {
        console.log(`   Notes: ${call.notes.substring(0, 100)}${call.notes.length > 100 ? '...' : ''}`);
      }
      
      console.log('   ' + '─'.repeat(50));
    });
    
    // Show transcript statistics
    const callsWithTranscripts = calls.filter(call => call.transcript && call.transcript.length > 0);
    const totalTranscriptChars = callsWithTranscripts.reduce((sum, call) => sum + (call.transcript?.length || 0), 0);
    
    console.log(`\n📈 TRANSCRIPT STATISTICS:`);
    console.log(`   Calls with transcripts: ${callsWithTranscripts.length}/${calls.length}`);
    console.log(`   Total transcript characters: ${totalTranscriptChars.toLocaleString()}`);
    console.log(`   Average transcript length: ${callsWithTranscripts.length ? Math.round(totalTranscriptChars / callsWithTranscripts.length) : 0} chars`);
    
    const twilioWebhookCalls = calls.filter(call => call.isFromTwilio);
    console.log(`   Twilio webhook calls: ${twilioWebhookCalls.length}`);
    console.log(`   Manual entries: ${calls.length - twilioWebhookCalls.length}`);
    
    console.log(`\n✅ Raw call data retrieval completed successfully`);
    console.log(`🔴 AI processing is DISABLED - showing raw data only`);
    
  } catch (error) {
    console.error('❌ Error testing raw call data:', error.message);
  }
}

testRawCallData();
