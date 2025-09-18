
import crypto from 'crypto';
import fetch from 'node-fetch';

// Test webhook with proper HMAC authentication
async function testWebhookWithHMAC() {
  try {
    console.log('🔐 Testing user3 webhook with HMAC authentication...');
    console.log('📡 Testing: https://skyiq.app/api/twilio/webhook/user3');
    console.log('=' .repeat(70));
    
    // Sample Twilio webhook data
    const webhookData = {
      CallSid: 'CA_HMAC_TEST_' + Date.now(),
      From: '+15551234567',
      To: '+16155788171',
      CallStatus: 'completed',
      CallDuration: '120',
      Direction: 'inbound',
      RecordingUrl: 'https://api.twilio.com/test-recording-url',
      TranscriptionText: 'Hello, this is a test call with HMAC authentication. I am interested in your services and would like to get more information about pricing and availability.',
      TranscriptionUrl: 'https://api.twilio.com/test-transcription-url',
      TranscriptionStatus: 'completed'
    };

    // Convert to URL-encoded format (how Twilio sends data)
    const formData = new URLSearchParams(webhookData).toString();
    
    // Generate HMAC signature (simulating Twilio's signature)
    const webhookUrl = 'https://skyiq.app/api/twilio/webhook/user3';
    const authToken = process.env.USER3_TWILIO_AUTH_TOKEN || 'wsec_b791d1bddd00cb6ed4b2476f2f97da0ad9619e81f1b37e56911e975d50cca96a';
    
    // Create the signature string (URL + POST body)
    const signatureString = webhookUrl + formData;
    
    // Generate HMAC-SHA1 signature (Twilio's method)
    const signature = crypto
      .createHmac('sha1', authToken)
      .update(signatureString)
      .digest('base64');
    
    const twilioSignature = `https://skyiq.app/api/twilio/webhook/user3=${signature}`;

    console.log('📝 Test webhook data:');
    console.log('  CallSid:', webhookData.CallSid);
    console.log('  From:', webhookData.From);
    console.log('  Status:', webhookData.CallStatus);
    console.log('  Transcript length:', webhookData.TranscriptionText.length, 'chars');
    console.log('🔐 HMAC Signature:', twilioSignature.substring(0, 50) + '...');
    console.log('─'.repeat(50));

    // Send POST request with HMAC signature
    const response = await fetch('https://skyiq.app/api/twilio/webhook/user3', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'X-Twilio-Signature': twilioSignature,
        'User-Agent': 'TwilioProxy/1.1'
      },
      body: formData
    });

    const responseText = await response.text();
    
    console.log('📥 Webhook Response Status:', response.status);
    console.log('📥 Webhook Response:', responseText);
    console.log('📥 Response Headers:', Object.fromEntries(response.headers.entries()));
    
    // Test without HMAC signature to verify security
    console.log('\n🚫 Testing without HMAC signature (should be rejected):');
    const unsecureResponse = await fetch('https://skyiq.app/api/twilio/webhook/user3', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'TwilioProxy/1.1'
      },
      body: formData
    });
    
    const unsecureResponseText = await unsecureResponse.text();
    console.log('🚫 Unsecure Response Status:', unsecureResponse.status);
    console.log('🚫 Unsecure Response:', unsecureResponseText);
    
    // Check if the call was stored in database
    console.log('\n🔍 Checking if call was stored in database...');
    const dbCheckResponse = await fetch('http://localhost:5000/api/calls/user/3');
    const dbData = await dbCheckResponse.json();
    
    if (dbData.data && dbData.data.length > 0) {
      const latestCall = dbData.data[dbData.data.length - 1];
      console.log('✅ Latest call in database:');
      console.log('  Call ID:', latestCall.id);
      console.log('  Phone:', latestCall.phoneNumber);
      console.log('  Status:', latestCall.status);
      console.log('  Transcript:', latestCall.transcript ? 'YES' : 'NO');
      console.log('  Created:', latestCall.createdAt);
    }
    
    // Summary
    console.log('\n📊 HMAC TEST SUMMARY:');
    console.log('═'.repeat(50));
    console.log(`✅ Authenticated request: ${response.status === 200 ? 'SUCCESS' : 'FAILED'}`);
    console.log(`🚫 Unauthenticated request: ${unsecureResponse.status === 403 ? 'PROPERLY BLOCKED' : 'SECURITY ISSUE'}`);
    console.log(`📝 Data stored: ${dbData.data && dbData.data.length > 0 ? 'YES' : 'NO'}`);
    
    if (response.status === 200 && unsecureResponse.status === 403) {
      console.log('\n🎉 HMAC AUTHENTICATION WORKING CORRECTLY!');
    } else {
      console.log('\n⚠️  HMAC authentication may need adjustment');
    }
    
  } catch (error) {
    console.error('❌ Error testing HMAC webhook:', error);
  }
}

// Run the test
testWebhookWithHMAC();
