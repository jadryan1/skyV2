
import crypto from 'crypto';
import fetch from 'node-fetch';
import { performance } from 'perf_hooks';

// Configuration
const WEBHOOK_URL = 'https://skyiq.app/api/twilio/webhook/user3';
const WEBHOOK_SECRET = 'wsec_b791d1bddd00cb6ed4b2476f2f97da0ad9619e81f1b37e56911e975d50cca96a';
const WRONG_SECRET = 'wrong_secret_key_for_testing';

// Test payload (ElevenLabs format)
const createTestPayload = (timestamp = Date.now()) => ({
  conversation_id: 'conv_test_' + timestamp,
  agent_id: 'agent_security_test',
  status: 'completed',
  start_time: new Date(timestamp).toISOString(),
  end_time: new Date(timestamp + 120000).toISOString(),
  duration_seconds: 120,
  transcript: 'Security test call transcript for HMAC validation testing.',
  summary: 'Test call for security validation',
  caller_phone: '+15551234567',
  recording_url: 'https://api.elevenlabs.io/recordings/rec_test_' + timestamp,
  metadata: {
    call_type: 'inbound',
    test_case: 'security_validation'
  }
});

// Generate HMAC signature
function generateHMACSignature(payload, secret) {
  const payloadString = typeof payload === 'string' ? payload : JSON.stringify(payload);
  return crypto
    .createHmac('sha256', secret)
    .update(payloadString)
    .digest('hex');
}

// Constant-time comparison simulation (Node.js crypto.timingSafeEqual would be better for real implementation)
function constantTimeCompare(a, b) {
  if (a.length !== b.length) {
    return false;
  }
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

// Test case class
class HMACTestCase {
  constructor(name, description, testFn) {
    this.name = name;
    this.description = description;
    this.testFn = testFn;
    this.passed = false;
    this.error = null;
    this.responseStatus = null;
    this.responseTime = null;
  }

  async run() {
    const startTime = performance.now();
    try {
      const result = await this.testFn();
      this.passed = result.passed;
      this.responseStatus = result.status;
      this.error = result.error;
    } catch (error) {
      this.passed = false;
      this.error = error.message;
    }
    this.responseTime = Math.round(performance.now() - startTime);
  }
}

// Test helper function
async function makeWebhookRequest(headers, body) {
  try {
    const response = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'ElevenLabs-Security-Test/1.0',
        ...headers
      },
      body: typeof body === 'string' ? body : JSON.stringify(body)
    });

    const responseText = await response.text();
    return {
      status: response.status,
      body: responseText,
      headers: Object.fromEntries(response.headers.entries())
    };
  } catch (error) {
    throw new Error(`Request failed: ${error.message}`);
  }
}

// Test suite
const testSuite = [
  // EDGE CASE 1: Empty signature headers
  new HMACTestCase(
    'Empty X-ElevenLabs-Signature Header',
    'Should reject requests with empty signature header',
    async () => {
      const payload = createTestPayload();
      const response = await makeWebhookRequest({
        'X-ElevenLabs-Signature': ''
      }, payload);
      
      return {
        passed: response.status === 403,
        status: response.status,
        error: response.status !== 403 ? `Expected 403, got ${response.status}: ${response.body}` : null
      };
    }
  ),

  // EDGE CASE 2: Missing signature header
  new HMACTestCase(
    'Missing Signature Header',
    'Should reject requests without signature header',
    async () => {
      const payload = createTestPayload();
      const response = await makeWebhookRequest({}, payload);
      
      return {
        passed: response.status === 403,
        status: response.status,
        error: response.status !== 403 ? `Expected 403, got ${response.status}: ${response.body}` : null
      };
    }
  ),

  // EDGE CASE 3: Malformed signature formats
  new HMACTestCase(
    'Malformed Signature Format - No Prefix',
    'Should reject signatures without sha256= prefix',
    async () => {
      const payload = createTestPayload();
      const signature = generateHMACSignature(payload, WEBHOOK_SECRET);
      
      const response = await makeWebhookRequest({
        'X-ElevenLabs-Signature': signature // Missing "sha256=" prefix
      }, payload);
      
      return {
        passed: response.status === 403,
        status: response.status,
        error: response.status !== 403 ? `Expected 403, got ${response.status}: ${response.body}` : null
      };
    }
  ),

  new HMACTestCase(
    'Malformed Signature Format - Invalid Hex',
    'Should reject signatures with invalid hex characters',
    async () => {
      const payload = createTestPayload();
      
      const response = await makeWebhookRequest({
        'X-ElevenLabs-Signature': 'sha256=invalid_hex_characters_zzzz'
      }, payload);
      
      return {
        passed: response.status === 403,
        status: response.status,
        error: response.status !== 403 ? `Expected 403, got ${response.status}: ${response.body}` : null
      };
    }
  ),

  new HMACTestCase(
    'Malformed Signature Format - Wrong Length',
    'Should reject signatures with incorrect length',
    async () => {
      const payload = createTestPayload();
      
      const response = await makeWebhookRequest({
        'X-ElevenLabs-Signature': 'sha256=short'
      }, payload);
      
      return {
        passed: response.status === 403,
        status: response.status,
        error: response.status !== 403 ? `Expected 403, got ${response.status}: ${response.body}` : null
      };
    }
  ),

  // EDGE CASE 4: Correct format but wrong secret
  new HMACTestCase(
    'Wrong Secret Key',
    'Should reject signatures generated with wrong secret',
    async () => {
      const payload = createTestPayload();
      const wrongSignature = generateHMACSignature(payload, WRONG_SECRET);
      
      const response = await makeWebhookRequest({
        'X-ElevenLabs-Signature': `sha256=${wrongSignature}`
      }, payload);
      
      return {
        passed: response.status === 403,
        status: response.status,
        error: response.status !== 403 ? `Expected 403, got ${response.status}: ${response.body}` : null
      };
    }
  ),

  // EDGE CASE 5: Body tampering
  new HMACTestCase(
    'Body Tampering Attack',
    'Should detect when payload is modified after signing',
    async () => {
      const originalPayload = createTestPayload();
      const signature = generateHMACSignature(originalPayload, WEBHOOK_SECRET);
      
      // Tamper with payload after generating signature
      const tamperedPayload = {
        ...originalPayload,
        caller_phone: '+1HACKED1111' // Changed phone number
      };
      
      const response = await makeWebhookRequest({
        'X-ElevenLabs-Signature': `sha256=${signature}`
      }, tamperedPayload);
      
      return {
        passed: response.status === 403,
        status: response.status,
        error: response.status !== 403 ? `Expected 403, got ${response.status}: ${response.body}` : null
      };
    }
  ),

  // POSITIVE CASE 1: Valid signature with correct secret
  new HMACTestCase(
    'Valid HMAC Signature',
    'Should accept request with valid signature',
    async () => {
      const payload = createTestPayload();
      const signature = generateHMACSignature(payload, WEBHOOK_SECRET);
      
      const response = await makeWebhookRequest({
        'X-ElevenLabs-Signature': `sha256=${signature}`
      }, payload);
      
      return {
        passed: response.status === 200,
        status: response.status,
        error: response.status !== 200 ? `Expected 200, got ${response.status}: ${response.body}` : null
      };
    }
  ),

  // POSITIVE CASE 2: Complex payload validation
  new HMACTestCase(
    'Complex ElevenLabs Payload',
    'Should handle complex real-world payload structure',
    async () => {
      const complexPayload = {
        conversation_id: 'conv_1234567890abcdef',
        agent_id: 'agent_prod_elevenlabs_test',
        status: 'completed',
        start_time: '2025-01-18T10:30:00.000Z',
        end_time: '2025-01-18T10:33:45.000Z',
        duration_seconds: 225,
        transcript: 'Customer: Hi, I\'m calling about your real estate services.\nAgent: Hello! I\'d be happy to help you with your real estate needs. What specific area are you interested in?\nCustomer: I\'m looking for a 3-bedroom house in downtown area, budget around $450,000.\nAgent: Great! I have several properties that match your criteria. Let me pull up some options for you.',
        summary: 'Real estate inquiry - 3BR house downtown, $450k budget, interested buyer',
        caller_phone: '+15551234567',
        recording_url: 'https://api.elevenlabs.io/recordings/rec_1234567890abcdef',
        metadata: {
          call_type: 'inbound',
          lead_quality: 'high',
          follow_up_required: true,
          keywords: ['real estate', 'downtown', '3-bedroom', '$450k'],
          sentiment: 'positive',
          call_quality_score: 0.95
        }
      };
      
      const signature = generateHMACSignature(complexPayload, WEBHOOK_SECRET);
      
      const response = await makeWebhookRequest({
        'X-ElevenLabs-Signature': `sha256=${signature}`
      }, complexPayload);
      
      return {
        passed: response.status === 200,
        status: response.status,
        error: response.status !== 200 ? `Expected 200, got ${response.status}: ${response.body}` : null
      };
    }
  ),

  // SECURITY TEST: Case sensitivity
  new HMACTestCase(
    'Case Sensitivity Test',
    'Should reject signatures with wrong case',
    async () => {
      const payload = createTestPayload();
      const signature = generateHMACSignature(payload, WEBHOOK_SECRET);
      
      const response = await makeWebhookRequest({
        'X-ElevenLabs-Signature': `SHA256=${signature}` // Wrong case for prefix
      }, payload);
      
      return {
        passed: response.status === 403,
        status: response.status,
        error: response.status !== 403 ? `Expected 403, got ${response.status}: ${response.body}` : null
      };
    }
  ),

  // SECURITY TEST: Different signature header names
  new HMACTestCase(
    'Wrong Header Name Test',
    'Should only accept X-ElevenLabs-Signature header',
    async () => {
      const payload = createTestPayload();
      const signature = generateHMACSignature(payload, WEBHOOK_SECRET);
      
      const response = await makeWebhookRequest({
        'X-Hub-Signature': `sha256=${signature}` // Wrong header name
      }, payload);
      
      return {
        passed: response.status === 403,
        status: response.status,
        error: response.status !== 403 ? `Expected 403, got ${response.status}: ${response.body}` : null
      };
    }
  ),

  // TIMING ATTACK TEST
  new HMACTestCase(
    'Timing Attack Resistance',
    'Should take similar time for valid and invalid signatures',
    async () => {
      const payload = createTestPayload();
      const validSignature = generateHMACSignature(payload, WEBHOOK_SECRET);
      const invalidSignature = generateHMACSignature(payload, WRONG_SECRET);
      
      // Test valid signature timing
      const validStart = performance.now();
      await makeWebhookRequest({
        'X-ElevenLabs-Signature': `sha256=${validSignature}`
      }, payload);
      const validTime = performance.now() - validStart;
      
      // Test invalid signature timing
      const invalidStart = performance.now();
      await makeWebhookRequest({
        'X-ElevenLabs-Signature': `sha256=${invalidSignature}`
      }, payload);
      const invalidTime = performance.now() - invalidStart;
      
      // Allow for some variance but they should be relatively close
      const timeDifference = Math.abs(validTime - invalidTime);
      const maxAllowedDifference = Math.max(validTime, invalidTime) * 0.5; // 50% variance allowed
      
      return {
        passed: timeDifference <= maxAllowedDifference,
        status: 200, // Both requests complete, we're testing timing
        error: timeDifference > maxAllowedDifference ? 
          `Timing difference too large: ${timeDifference.toFixed(2)}ms (valid: ${validTime.toFixed(2)}ms, invalid: ${invalidTime.toFixed(2)}ms)` : 
          null
      };
    }
  )
];

// Run all tests
async function runSecurityTestSuite() {
  console.log('🔒 HMAC Security Test Suite Starting...');
  console.log('=' .repeat(70));
  console.log('🎯 Testing webhook endpoint:', WEBHOOK_URL);
  console.log('🔑 Using secret:', WEBHOOK_SECRET.substring(0, 10) + '...');
  console.log('=' .repeat(70));
  
  let passedTests = 0;
  let failedTests = 0;
  
  for (const test of testSuite) {
    process.stdout.write(`🧪 ${test.name}... `);
    
    await test.run();
    
    if (test.passed) {
      console.log(`✅ PASSED (${test.responseTime}ms)`);
      passedTests++;
    } else {
      console.log(`❌ FAILED (${test.responseTime}ms)`);
      console.log(`   📝 ${test.description}`);
      console.log(`   🚨 ${test.error}`);
      console.log(`   📊 Status: ${test.responseStatus}`);
      failedTests++;
    }
  }
  
  console.log('\n' + '=' .repeat(70));
  console.log('📊 SECURITY TEST RESULTS:');
  console.log('=' .repeat(70));
  console.log(`✅ Passed: ${passedTests}`);
  console.log(`❌ Failed: ${failedTests}`);
  console.log(`📈 Success Rate: ${((passedTests / testSuite.length) * 100).toFixed(1)}%`);
  
  if (failedTests === 0) {
    console.log('\n🎉 ALL SECURITY TESTS PASSED!');
    console.log('🛡️  HMAC authentication is properly secured');
  } else {
    console.log('\n⚠️  SECURITY ISSUES DETECTED!');
    console.log('🔧 Please fix the failing tests before deploying');
  }
  
  console.log('\n🔍 SECURITY RECOMMENDATIONS:');
  console.log('─'.repeat(70));
  console.log('1. ✅ Use constant-time comparison for signature validation');
  console.log('2. ✅ Validate signature format before processing');
  console.log('3. ✅ Log failed authentication attempts');
  console.log('4. ⚠️  Consider implementing timestamp validation for replay protection');
  console.log('5. ⚠️  Consider rate limiting per IP for failed attempts');
  console.log('6. ✅ Ensure proper error messages don\'t leak information');
  
  return {
    totalTests: testSuite.length,
    passed: passedTests,
    failed: failedTests,
    successRate: (passedTests / testSuite.length) * 100
  };
}

// Additional utility: Test constant-time comparison
function testConstantTimeComparison() {
  console.log('\n🔍 Testing Constant-Time Comparison Implementation:');
  console.log('─'.repeat(50));
  
  const testCases = [
    ['same_string', 'same_string', true],
    ['different_1', 'different_2', false],
    ['short', 'much_longer_string', false],
    ['', '', true],
    ['a', 'b', false]
  ];
  
  testCases.forEach(([a, b, expected], index) => {
    const result = constantTimeCompare(a, b);
    const status = result === expected ? '✅' : '❌';
    console.log(`${status} Test ${index + 1}: "${a}" vs "${b}" = ${result}`);
  });
}

// Run the test suite
console.log('🚀 Initializing HMAC Security Validation...\n');
testConstantTimeComparison();

runSecurityTestSuite().then((results) => {
  process.exit(results.failed > 0 ? 1 : 0);
}).catch((error) => {
  console.error('💥 Test suite crashed:', error);
  process.exit(1);
});
