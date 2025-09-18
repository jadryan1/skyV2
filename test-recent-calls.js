
import fetch from 'node-fetch';

async function testRecentCalls() {
  try {
    console.log('🔍 Testing most recent calls for user 3...');
    
    const response = await fetch('http://localhost:5000/api/calls/user/3');
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const data = await response.json();
    const calls = data.data || [];
    
    console.log(`\n📊 CALL SUMMARY:`);
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
    
    console.log(`\n🔥 MOST RECENT CALLS:`);
    console.log('=' .repeat(60));
    
    // Show the 5 most recent calls
    sortedCalls.slice(0, 5).forEach((call, index) => {
      const date = call.createdAt ? 
        new Date(call.createdAt).toLocaleString() : 
        `${call.date} ${call.time || ''}`;
      
      const duration = typeof call.duration === 'number' ? 
        `${Math.floor(call.duration / 60)}m ${call.duration % 60}s` : 
        (call.duration || 'N/A');
      
      console.log(`\n📞 CALL #${index + 1}`);
      console.log(`   Phone: ${call.phoneNumber || call.number || 'Unknown'}`);
      console.log(`   Contact: ${call.contactName || call.name || 'Unknown'}`);
      console.log(`   Date: ${date}`);
      console.log(`   Duration: ${duration}`);
      console.log(`   Status: ${call.status?.toUpperCase() || 'UNKNOWN'}`);
      console.log(`   Direction: ${call.direction || 'N/A'}`);
      
      if (call.summary) {
        console.log(`   Summary: ${call.summary.substring(0, 100)}${call.summary.length > 100 ? '...' : ''}`);
      }
      
      if (call.isFromTwilio) {
        console.log(`   Source: 🔗 Twilio (Auto-logged)`);
      } else {
        console.log(`   Source: ✍️ Manual Entry`);
      }
      
      console.log('   ' + '-'.repeat(50));
    });
    
    // Show call statistics
    const completedCalls = calls.filter(call => call.status === 'completed').length;
    const missedCalls = calls.filter(call => call.status === 'missed').length;
    const failedCalls = calls.filter(call => call.status === 'failed').length;
    const twilioCalls = calls.filter(call => call.isFromTwilio).length;
    
    console.log(`\n📈 STATISTICS:`);
    console.log(`   Completed: ${completedCalls}`);
    console.log(`   Missed: ${missedCalls}`);
    console.log(`   Failed: ${failedCalls}`);
    console.log(`   Auto-logged (Twilio): ${twilioCalls}`);
    console.log(`   Manual entries: ${calls.length - twilioCalls}`);
    
  } catch (error) {
    console.error('❌ Error testing recent calls:', error.message);
  }
}

testRecentCalls();
