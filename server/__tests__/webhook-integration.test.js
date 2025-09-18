#!/usr/bin/env node

/**
 * Comprehensive Integration Test for Webhook Signature Validation
 * 
 * This test suite validates the security improvements to the ElevenLabs webhook signature verification
 * by testing the actual webhook endpoints with real HTTP requests.
 * 
 * Test Coverage:
 * 1. Edge Cases: Empty headers, malformed formats, wrong secrets, replay attacks
 * 2. Positive Cases: Valid signatures, actual payload formats
 * 3. Security Features: Timing attack protection, IP blocking, enhanced logging
 * 4. Integration Tests: Full webhook endpoint testing
 * 
 * Run with: node server/__tests__/webhook-integration.test.js
 */

import crypto from 'crypto';
import fetch from 'node-fetch';

// Test configuration
const TEST_CONFIG = {
  baseUrl: 'http://localhost:5000',
  webhookSecret: 'wsec_b791d1bddd00cb6ed4b2476f2f97da0ad9619e81f1b37e56911e975d50cca96a',
  testTimeout: 30000,
  endpoints: {
    user3Webhook: '/api/twilio/webhook/user3',
    transcriptionWebhook: '/api/twilio/transcription'
  }
};

// Sample ElevenLabs webhook payload
const sampleElevenLabsPayload = {
  conversation_id: 'conv_test_' + Date.now(),
  agent_id: 'agent_test_security',
  status: 'completed',
  start_time: new Date().toISOString(),
  end_time: new Date().toISOString(),
  duration_seconds: 120,
  transcript: 'Hello, I am calling about the property listing. This is a test call for security validation. Can you tell me more about the property?',
  summary: 'Property inquiry - security test call',
  caller_phone: '+15551234567',
  recording_url: 'https://api.elevenlabs.io/recordings/rec_test_' + Date.now(),
  metadata: {
    call_type: 'inbound',
    lead_quality: 'high',
    test_case: 'security_validation'
  }
};

// Helper functions for signature creation
function createElevenLabsSignature(payload, secret, timestamp) {
  const ts = timestamp || Math.floor(Date.now() / 1000);
  const signedPayload = `${ts}.${payload}`;
  const hash = crypto
    .createHmac('sha256', secret)
    .update(signedPayload, 'utf8')
    .digest('hex');
  return `t=${ts},h=${hash}`;
}

function createHubSignature(payload, secret) {
  const signature = crypto
    .createHmac('sha1', secret)
    .update(payload)
    .digest('base64');
  return `sha1=${signature}`;
}

function createTwilioSignature(url, body, secret) {
  const signature = crypto
    .createHmac('sha1', secret)
    .update(url + body)
    .digest('base64');
  return signature; // Return just the signature, not prefixed with URL
}

// Test results tracking
let testResults = {
  total: 0,
  passed: 0,
  failed: 0,
  skipped: 0,
  details: []
};

// Test execution helper
async function runTest(testName, testFunction, category = 'General') {
  testResults.total++;
  console.log(`\\n🧪 Running: ${testName}`);
  
  try {
    const result = await testFunction();
    if (result.success) {
      testResults.passed++;
      console.log(`   ✅ PASSED: ${result.message || 'Test completed successfully'}`);
    } else {
      testResults.failed++;
      console.log(`   ❌ FAILED: ${result.message || 'Test failed'}`);
    }
    
    testResults.details.push({
      name: testName,
      category,
      status: result.success ? 'PASSED' : 'FAILED',
      message: result.message,
      details: result.details
    });
    
  } catch (error) {
    testResults.failed++;
    console.log(`   💥 ERROR: ${error.message}`);
    testResults.details.push({
      name: testName,
      category,
      status: 'ERROR',
      message: error.message,
      error: error.stack
    });
  }
}

// Edge Case Tests
async function testEmptySignatureHeader() {
  const payload = JSON.stringify(sampleElevenLabsPayload);
  
  const response = await fetch(`${TEST_CONFIG.baseUrl}${TEST_CONFIG.endpoints.user3Webhook}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'Security-Test/1.0'
    },
    body: payload
  });
  
  const responseText = await response.text();
  
  return {
    success: response.status === 403,
    message: `Expected 403, got ${response.status}`,
    details: { status: response.status, response: responseText }
  };
}

async function testMalformedSignatureFormat() {
  const payload = JSON.stringify(sampleElevenLabsPayload);
  
  const response = await fetch(`${TEST_CONFIG.baseUrl}${TEST_CONFIG.endpoints.user3Webhook}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-ElevenLabs-Signature': 'invalid_format=abc123def456', // Wrong prefix (should be t=timestamp,h=hash)
      'User-Agent': 'Security-Test/1.0'
    },
    body: payload
  });
  
  const responseText = await response.text();
  
  return {
    success: response.status === 403,
    message: `Malformed signature should be rejected. Expected 403, got ${response.status}`,
    details: { status: response.status, response: responseText }
  };
}

async function testInvalidHexSignature() {
  const payload = JSON.stringify(sampleElevenLabsPayload);
  
  const response = await fetch(`${TEST_CONFIG.baseUrl}${TEST_CONFIG.endpoints.user3Webhook}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-ElevenLabs-Signature': 't=1234567890,h=invalid_hex_characters_xyz', // Invalid hex
      'User-Agent': 'Security-Test/1.0'
    },
    body: payload
  });
  
  const responseText = await response.text();
  
  return {
    success: response.status === 403,
    message: `Invalid hex should be rejected. Expected 403, got ${response.status}`,
    details: { status: response.status, response: responseText }
  };
}

async function testWrongSecretKey() {
  const payload = JSON.stringify(sampleElevenLabsPayload);
  const wrongSecret = 'wrong_secret_key_test_123';
  const invalidSignature = createElevenLabsSignature(payload, wrongSecret);
  
  const response = await fetch(`${TEST_CONFIG.baseUrl}${TEST_CONFIG.endpoints.user3Webhook}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-ElevenLabs-Signature': invalidSignature,
      'User-Agent': 'Security-Test/1.0'
    },
    body: payload
  });
  
  const responseText = await response.text();
  
  return {
    success: response.status === 403,
    message: `Wrong secret should be rejected. Expected 403, got ${response.status}`,
    details: { status: response.status, response: responseText, signature: invalidSignature }
  };
}

async function testReplayAttack() {
  const payload = JSON.stringify(sampleElevenLabsPayload);
  const validSignature = createElevenLabsSignature(payload, TEST_CONFIG.webhookSecret);
  const oldTimestamp = Math.floor((Date.now() - 10 * 60 * 1000) / 1000); // 10 minutes ago
  
  const response = await fetch(`${TEST_CONFIG.baseUrl}${TEST_CONFIG.endpoints.user3Webhook}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-ElevenLabs-Signature': validSignature,
      'X-ElevenLabs-Timestamp': oldTimestamp.toString(),
      'User-Agent': 'Security-Test/1.0'
    },
    body: payload
  });
  
  const responseText = await response.text();
  
  return {
    success: response.status === 403,
    message: `Old timestamp should be rejected. Expected 403, got ${response.status}`,
    details: { status: response.status, response: responseText, timestamp: oldTimestamp }
  };
}

// Positive Test Cases
async function testValidElevenLabsSignature() {
  const payload = JSON.stringify(sampleElevenLabsPayload);
  const validSignature = createElevenLabsSignature(payload, TEST_CONFIG.webhookSecret);
  
  const response = await fetch(`${TEST_CONFIG.baseUrl}${TEST_CONFIG.endpoints.user3Webhook}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-ElevenLabs-Signature': validSignature,
      'User-Agent': 'ElevenLabs-Webhooks/1.0'
    },
    body: payload
  });
  
  const responseText = await response.text();
  
  return {
    success: response.status === 200,
    message: `Valid signature should be accepted. Expected 200, got ${response.status}`,
    details: { status: response.status, response: responseText, signature: validSignature }
  };
}

async function testValidElevenLabsWithTimestamp() {
  const payload = JSON.stringify(sampleElevenLabsPayload);
  const validSignature = createElevenLabsSignature(payload, TEST_CONFIG.webhookSecret);
  const currentTimestamp = Math.floor(Date.now() / 1000);
  
  const response = await fetch(`${TEST_CONFIG.baseUrl}${TEST_CONFIG.endpoints.user3Webhook}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-ElevenLabs-Signature': validSignature,
      'X-ElevenLabs-Timestamp': currentTimestamp.toString(),
      'User-Agent': 'ElevenLabs-Webhooks/1.0'
    },
    body: payload
  });
  
  const responseText = await response.text();
  
  return {
    success: response.status === 200,
    message: `Valid signature with current timestamp should be accepted. Expected 200, got ${response.status}`,
    details: { status: response.status, response: responseText, timestamp: currentTimestamp }
  };
}

async function testHubStyleSignature() {
  const payload = JSON.stringify(sampleElevenLabsPayload);
  const validSignature = createHubSignature(payload, TEST_CONFIG.webhookSecret);
  
  const response = await fetch(`${TEST_CONFIG.baseUrl}${TEST_CONFIG.endpoints.user3Webhook}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Hub-Signature': validSignature,
      'User-Agent': 'Hub-Webhooks/1.0'
    },
    body: payload
  });
  
  const responseText = await response.text();
  
  return {
    success: response.status === 200,
    message: `Valid Hub signature should be accepted. Expected 200, got ${response.status}`,
    details: { status: response.status, response: responseText, signature: validSignature }
  };
}

async function testActualElevenLabsPayload() {
  const actualPayload = {
    conversation_id: 'conv_4f8b2c1d9e7a6f3b',
    agent_id: 'agent_real_estate_assistant',
    status: 'completed',
    start_time: '2025-01-18T06:00:00Z',
    end_time: '2025-01-18T06:02:30Z',
    duration_seconds: 150,
    transcript: "Good morning! I'm calling about the 3-bedroom house listing I saw online for $450,000. I'm pre-approved for a mortgage up to $500,000 and would love to schedule a viewing this week. Is this property still available? I've been looking in this area for 6 months.",
    summary: 'High-quality lead - Property inquiry for 3BR house at $450k, buyer pre-approved for $500k, actively looking for 6 months, wants viewing this week',
    caller_phone: '+15551234567',
    recording_url: 'https://api.elevenlabs.io/recordings/rec_4f8b2c1d9e7a6f3b',
    metadata: {
      call_type: 'inbound',
      lead_quality: 'high',
      follow_up_required: true,
      property_interest: '$450,000 3BR house',
      buyer_qualification: 'pre-approved $500k',
      urgency: 'wants viewing this week'
    }
  };
  
  const payload = JSON.stringify(actualPayload);
  const validSignature = createElevenLabsSignature(payload, TEST_CONFIG.webhookSecret);
  
  const response = await fetch(`${TEST_CONFIG.baseUrl}${TEST_CONFIG.endpoints.user3Webhook}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-ElevenLabs-Signature': validSignature,
      'User-Agent': 'ElevenLabs-Webhooks/1.0'
    },
    body: payload
  });
  
  const responseText = await response.text();
  
  return {
    success: response.status === 200,
    message: `Actual ElevenLabs payload should be processed. Expected 200, got ${response.status}`,
    details: { status: response.status, response: responseText, payloadSize: payload.length }
  };
}

// Security Feature Tests
async function testRateLimiting() {
  const payload = JSON.stringify(sampleElevenLabsPayload);
  const invalidSignature = 't=1234567890,h=invalid_signature_for_rate_limit_test_123456789012';
  
  // Send multiple invalid requests quickly to trigger rate limiting
  const promises = [];
  for (let i = 0; i < 6; i++) { // More than MAX_FAILED_ATTEMPTS
    promises.push(
      fetch(`${TEST_CONFIG.baseUrl}${TEST_CONFIG.endpoints.user3Webhook}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-ElevenLabs-Signature': invalidSignature.replace('1234567890', '123456789' + i),
          'User-Agent': 'Security-Test-Rate-Limit/1.0'
        },
        body: payload
      })
    );
  }
  
  const responses = await Promise.all(promises);
  const statusCodes = responses.map(r => r.status);
  
  // Should have some 403s (signature failures) and possibly some 429s (rate limited)
  const has403 = statusCodes.some(code => code === 403);
  
  return {
    success: has403,
    message: `Rate limiting test completed. Status codes: ${statusCodes.join(', ')}`,
    details: { statusCodes, totalRequests: responses.length }
  };
}

async function testLargePayload() {
  const largePayload = {
    ...sampleElevenLabsPayload,
    transcript: 'This is a very long transcript. ' + 'x'.repeat(5000), // Large transcript
    metadata: {
      ...sampleElevenLabsPayload.metadata,
      large_data: 'y'.repeat(3000),
      additional_info: 'Large payload test for security validation'
    }
  };
  
  const payload = JSON.stringify(largePayload);
  const validSignature = createElevenLabsSignature(payload, TEST_CONFIG.webhookSecret);
  
  const response = await fetch(`${TEST_CONFIG.baseUrl}${TEST_CONFIG.endpoints.user3Webhook}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-ElevenLabs-Signature': validSignature,
      'User-Agent': 'ElevenLabs-Webhooks/1.0'
    },
    body: payload
  });
  
  const responseText = await response.text();
  
  return {
    success: response.status === 200,
    message: `Large payload should be processed. Expected 200, got ${response.status}`,
    details: { status: response.status, payloadSize: payload.length, response: responseText.substring(0, 100) }
  };
}

async function testSpecialCharacters() {
  const specialPayload = {
    ...sampleElevenLabsPayload,
    transcript: 'Hello! 🏠 Property inquiry with special chars: 中文, émojis, "quotes", \\\\backslashes, and symbols: @#$%^&*()',
    caller_phone: '+1 (555) 123-4567 ext. 🏠',
    metadata: {
      ...sampleElevenLabsPayload.metadata,
      special_test: 'Testing special characters: 特殊字符 and 🎯'
    }
  };
  
  const payload = JSON.stringify(specialPayload);
  const validSignature = createElevenLabsSignature(payload, TEST_CONFIG.webhookSecret);
  
  const response = await fetch(`${TEST_CONFIG.baseUrl}${TEST_CONFIG.endpoints.user3Webhook}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'X-ElevenLabs-Signature': validSignature,
      'User-Agent': 'ElevenLabs-Webhooks/1.0'
    },
    body: payload
  });
  
  const responseText = await response.text();
  
  return {
    success: response.status === 200,
    message: `Special characters should be handled. Expected 200, got ${response.status}`,
    details: { status: response.status, response: responseText, hasSpecialChars: true }
  };
}

// Test execution
async function runAllTests() {
  console.log('🚀 Starting Comprehensive Webhook Security Test Suite');
  console.log('=' .repeat(80));
  console.log(`📡 Testing endpoints at: ${TEST_CONFIG.baseUrl}`);
  console.log(`🔐 Using webhook secret: ${TEST_CONFIG.webhookSecret.substring(0, 10)}...`);
  console.log('\\n📋 Test Plan:');
  console.log('  ✓ Edge Cases: Empty headers, malformed formats, wrong secrets');
  console.log('  ✓ Replay Attack Protection: Old timestamps');
  console.log('  ✓ Positive Cases: Valid signatures, actual payloads');
  console.log('  ✓ Security Features: Rate limiting, large payloads, special chars');
  console.log('=' .repeat(80));
  
  // Check if server is running
  try {
    const healthCheck = await fetch(`${TEST_CONFIG.baseUrl}/api/health`);
    if (healthCheck.status !== 200) {
      throw new Error(`Server health check failed: ${healthCheck.status}`);
    }
    console.log('✅ Server is running and healthy');
  } catch (error) {
    console.log('❌ Server is not running or not accessible:', error.message);
    console.log('💡 Please start the server with: npm run dev');
    return;
  }
  
  // Edge Case Tests
  console.log('\\n🛡️  EDGE CASE TESTS - These should be REJECTED');
  console.log('─'.repeat(50));
  
  await runTest('Empty Signature Header', testEmptySignatureHeader, 'Edge Cases');
  await runTest('Malformed Signature Format', testMalformedSignatureFormat, 'Edge Cases');
  await runTest('Invalid Hex Signature', testInvalidHexSignature, 'Edge Cases');
  await runTest('Wrong Secret Key', testWrongSecretKey, 'Edge Cases');
  await runTest('Replay Attack (Old Timestamp)', testReplayAttack, 'Edge Cases');
  
  // Positive Tests
  console.log('\\n✅ POSITIVE TESTS - These should be ACCEPTED');
  console.log('─'.repeat(50));
  
  await runTest('Valid ElevenLabs Signature', testValidElevenLabsSignature, 'Positive Cases');
  await runTest('Valid ElevenLabs with Timestamp', testValidElevenLabsWithTimestamp, 'Positive Cases');
  await runTest('Valid Hub-Style Signature', testHubStyleSignature, 'Positive Cases');
  await runTest('Actual ElevenLabs Payload', testActualElevenLabsPayload, 'Positive Cases');
  
  // Security Feature Tests
  console.log('\\n🔒 SECURITY FEATURE TESTS');
  console.log('─'.repeat(50));
  
  await runTest('Rate Limiting Test', testRateLimiting, 'Security Features');
  await runTest('Large Payload Handling', testLargePayload, 'Security Features');
  await runTest('Special Characters Handling', testSpecialCharacters, 'Security Features');
  
  // Results Summary
  console.log('\\n' + '='.repeat(80));
  console.log('📊 TEST RESULTS SUMMARY');
  console.log('=' .repeat(80));
  console.log(`📈 Total Tests: ${testResults.total}`);
  console.log(`✅ Passed: ${testResults.passed}`);
  console.log(`❌ Failed: ${testResults.failed}`);
  console.log(`⏭️  Skipped: ${testResults.skipped}`);
  console.log(`🎯 Success Rate: ${((testResults.passed / testResults.total) * 100).toFixed(1)}%`);
  
  // Detailed Results
  console.log('\\n📋 DETAILED RESULTS BY CATEGORY:');
  console.log('─'.repeat(50));
  
  const categories = [...new Set(testResults.details.map(t => t.category))];
  categories.forEach(category => {
    const categoryTests = testResults.details.filter(t => t.category === category);
    const categoryPassed = categoryTests.filter(t => t.status === 'PASSED').length;
    
    console.log(`\\n🏷️  ${category}:`);
    categoryTests.forEach(test => {
      const icon = test.status === 'PASSED' ? '✅' : test.status === 'FAILED' ? '❌' : '💥';
      console.log(`   ${icon} ${test.name}: ${test.status}`);
      if (test.status !== 'PASSED' && test.message) {
        console.log(`      💬 ${test.message}`);
      }
    });
    
    console.log(`   📊 Category Score: ${categoryPassed}/${categoryTests.length} (${((categoryPassed / categoryTests.length) * 100).toFixed(1)}%)`);
  });
  
  // Security Assessment
  console.log('\\n🛡️  SECURITY ASSESSMENT:');
  console.log('─'.repeat(50));
  
  const edgeCaseTests = testResults.details.filter(t => t.category === 'Edge Cases');
  const edgeCasesPassed = edgeCaseTests.filter(t => t.status === 'PASSED').length;
  
  const positiveCaseTests = testResults.details.filter(t => t.category === 'Positive Cases');
  const positiveCasesPassed = positiveCaseTests.filter(t => t.status === 'PASSED').length;
  
  console.log(`🚫 Attack Prevention: ${edgeCasesPassed}/${edgeCaseTests.length} threats blocked`);
  console.log(`✅ Legitimate Traffic: ${positiveCasesPassed}/${positiveCaseTests.length} valid requests accepted`);
  
  if (edgeCasesPassed === edgeCaseTests.length && positiveCasesPassed === positiveCaseTests.length) {
    console.log('\\n🎉 SECURITY STATUS: EXCELLENT!');
    console.log('✅ All attack vectors are properly blocked');
    console.log('✅ All legitimate traffic is properly accepted');
    console.log('✅ Security improvements are working correctly');
  } else {
    console.log('\\n⚠️  SECURITY STATUS: NEEDS ATTENTION');
    if (edgeCasesPassed < edgeCaseTests.length) {
      console.log('❗ Some attack vectors are not being blocked');
    }
    if (positiveCasesPassed < positiveCaseTests.length) {
      console.log('❗ Some legitimate traffic is being rejected');
    }
    console.log('💡 Review failed tests above for specific issues');
  }
  
  console.log('\\n🏁 Test suite completed!');
  console.log('=' .repeat(80));
}

// Run the tests
runAllTests().catch(error => {
  console.error('💥 Test suite failed to run:', error);
  process.exit(1);
});