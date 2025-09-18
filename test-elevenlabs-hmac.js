
import crypto from 'crypto';
import fetch from 'node-fetch';

// Test ElevenLabs webhook with proper HMAC authentication
async function testElevenLabsHMAC() {
  try {
    console.log('🎯 Testing ElevenLabs HMAC webhook authentication...');
    console.log('📡 Endpoint: https://skyiq.app/api/twilio/webhook/user3');
    console.log('🔐 Auth Method: HMAC (ElevenLabs style)');
    console.log('=' .repeat(70));
    
    // ElevenLabs webhook payload structure
    const elevenLabsPayload = {
      conversation_id: 'conv_' + Date.now(),
      agent_id: 'agent_rhow_properties',
      status: 'completed',
      start_time: new Date().toISOString(),
      end_time: new Date().toISOString(),
      duration_seconds: 120,
      transcript: 'Hello, I am calling about the property listing on Zillow. I saw the 3-bedroom house for $450,000 and I am very interested. Can you tell me more about the neighborhood and when I can schedule a viewing? I am pre-approved for a mortgage up to $500,000.',
      summary: 'Potential buyer inquiry about 3BR property listing, pre-approved for $500k mortgage, interested in viewing',
      caller_phone: '+15551234567',
      recording_url: 'https://api.elevenlabs.io/recordings/rec_' + Date.now(),
      metadata: {
        call_type: 'inbound',
        lead_quality: 'high',
        follow_up_required: true
      }
    };

    // Convert to JSON string (how ElevenLabs sends data)
    const payloadString = JSON.stringify(elevenLabsPayload);
    
    // ElevenLabs webhook URL and secret
    const webhookUrl = 'https://skyiq.app/api/twilio/webhook/user3';
    const webhookSecret = 'wsec_b791d1bddd00cb6ed4b2476f2f97da0ad9619e81f1b37e56911e975d50cca96a';
    
    // Generate ElevenLabs-style HMAC signature
    // ElevenLabs typically uses SHA-256 HMAC with webhook secret
    const signature = crypto
      .createHmac('sha256', webhookSecret)
      .update(payloadString)
      .digest('hex');
    
    const elevenLabsSignature = `sha256=${signature}`;

    console.log('📝 ElevenLabs webhook data:');
    console.log('  Conversation ID:', elevenLabsPayload.conversation_id);
    console.log('  Agent ID:', elevenLabsPayload.agent_id);
    console.log('  Status:', elevenLabsPayload.status);
    console.log('  Duration:', elevenLabsPayload.duration_seconds + 's');
    console.log('  Caller:', elevenLabsPayload.caller_phone);
    console.log('  Transcript length:', elevenLabsPayload.transcript.length, 'chars');
    console.log('🔐 HMAC Signature:', elevenLabsSignature.substring(0, 20) + '...');
    console.log('─'.repeat(50));

    // Test 1: Send ElevenLabs webhook with HMAC signature
    console.log('🧪 TEST 1: ElevenLabs webhook with HMAC authentication');
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-ElevenLabs-Signature': elevenLabsSignature,
        'User-Agent': 'ElevenLabs-Webhooks/1.0'
      },
      body: payloadString
    });

    const responseText = await response.text();
    console.log('📥 Response Status:', response.status);
    console.log('📥 Response Body:', responseText);
    console.log('📥 Response Headers:', Object.fromEntries(response.headers.entries()));
    
    // Test 2: Send without HMAC signature (should be rejected)
    console.log('\n🧪 TEST 2: ElevenLabs webhook WITHOUT HMAC (should fail)');
    const unsecureResponse = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'ElevenLabs-Webhooks/1.0'
      },
      body: payloadString
    });
    
    const unsecureResponseText = await unsecureResponse.text();
    console.log('🚫 Unsecure Response Status:', unsecureResponse.status);
    console.log('🚫 Unsecure Response:', unsecureResponseText);
    
    // Test 3: Send with invalid HMAC signature
    console.log('\n🧪 TEST 3: ElevenLabs webhook with INVALID HMAC (should fail)');
    const invalidSignature = 'sha256=invalid_signature_12345';
    const invalidResponse = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-ElevenLabs-Signature': invalidSignature,
        'User-Agent': 'ElevenLabs-Webhooks/1.0'
      },
      body: payloadString
    });
    
    const invalidResponseText = await invalidResponse.text();
    console.log('❌ Invalid HMAC Response Status:', invalidResponse.status);
    console.log('❌ Invalid HMAC Response:', invalidResponseText);
    
    // Check if the call was stored in database
    console.log('\n🔍 Checking database for new call records...');
    const dbCheckResponse = await fetch('http://localhost:5000/api/calls/user/3');
    const dbData = await dbCheckResponse.json();
    
    if (dbData.data && dbData.data.length > 0) {
      const latestCall = dbData.data[dbData.data.length - 1];
      const isNewCall = new Date(latestCall.createdAt).getTime() > (Date.now() - 60000); // Within last minute
      
      console.log('📊 Database Check:');
      console.log('  Total calls:', dbData.data.length);
      console.log('  Latest call ID:', latestCall.id);
      console.log('  Phone:', latestCall.phoneNumber);
      console.log('  Status:', latestCall.status);
      console.log('  Has transcript:', latestCall.transcript ? 'YES (' + latestCall.transcript.length + ' chars)' : 'NO');
      console.log('  Created:', latestCall.createdAt);
      console.log('  Is new call:', isNewCall ? '✅ YES' : '❌ NO');
    }
    
    // Test summary
    console.log('\n📊 ELEVENLABS HMAC TEST RESULTS:');
    console.log('═'.repeat(50));
    console.log(`✅ Valid HMAC request: ${response.status === 200 ? '✅ SUCCESS' : '❌ FAILED (' + response.status + ')'}`);
    console.log(`🚫 No HMAC request: ${unsecureResponse.status === 403 ? '✅ PROPERLY BLOCKED' : '❌ SECURITY ISSUE'}`);
    console.log(`❌ Invalid HMAC request: ${invalidResponse.status === 403 ? '✅ PROPERLY BLOCKED' : '❌ SECURITY ISSUE'}`);
    
    if (response.status === 200 && unsecureResponse.status === 403 && invalidResponse.status === 403) {
      console.log('\n🎉 ELEVENLABS HMAC AUTHENTICATION WORKING PERFECTLY!');
      console.log('✅ Valid signatures accepted');
      console.log('✅ Missing signatures rejected');
      console.log('✅ Invalid signatures rejected');
    } else {
      console.log('\n⚠️  HMAC authentication needs adjustment');
      console.log('💡 Check your webhook secret configuration');
      console.log('💡 Verify signature validation logic');
    }
    
  } catch (error) {
    console.error('❌ Error testing ElevenLabs HMAC webhook:', error);
  }
}

// Alternative test with different HMAC format (some services use different formats)
async function testAlternativeHMAC() {
  console.log('\n' + '='.repeat(70));
  console.log('🔄 TESTING ALTERNATIVE HMAC FORMAT...');
  console.log('='.repeat(70));
  
  try {
    const payload = {
      call_id: 'elevenlabs_' + Date.now(),
      phone: '+15551234567',
      status: 'completed',
      transcript: 'This is a test call from ElevenLabs with alternative HMAC format.',
      duration: 90
    };
    
    const payloadString = JSON.stringify(payload);
    const webhookSecret = process.env.USER3_TWILIO_AUTH_TOKEN || 'wsec_b791d1bddd00cb6ed4b2476f2f97da0ad9619e81f1b37e56911e975d50cca96a';
    
    // Alternative format: base64 encoded SHA-1 (similar to Twilio)
    const signature = crypto
      .createHmac('sha1', webhookSecret)
      .update(payloadString)
      .digest('base64');
    
    const response = await fetch('https://skyiq.app/api/twilio/webhook/user3', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Hub-Signature': `sha1=${signature}`,
        'User-Agent': 'ElevenLabs-Alternative/1.0'
      },
      body: payloadString
    });
    
    console.log('🧪 Alternative HMAC Response:', response.status, await response.text());
    
  } catch (error) {
    console.error('❌ Alternative HMAC test error:', error);
  }
}

// Run both tests
console.log('🚀 Starting ElevenLabs HMAC webhook tests...\n');
await testElevenLabsHMAC();
await testAlternativeHMAC();

console.log('\n🏁 All ElevenLabs HMAC tests completed!');
