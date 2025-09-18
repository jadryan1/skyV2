#!/usr/bin/env node

/**
 * Production Readiness Test for Webhook Signature Validation Fixes
 * 
 * This script validates all the critical fixes implemented:
 * 1. ElevenLabs t=timestamp,h=hash format
 * 2. Twilio signature verification (no URLSearchParams, no URL prefix)
 * 3. Raw body handling
 * 4. ElevenLabs replay protection
 * 5. Security hardening
 */

import crypto from 'crypto';
import fetch from 'node-fetch';

const TEST_CONFIG = {
  baseUrl: 'http://localhost:5000',
  webhookSecret: 'wsec_b791d1bddd00cb6ed4b2476f2f97da0ad9619e81f1b37e56911e975d50cca96a',
  testTimeout: 30000
};

// Test results tracking
let testResults = {
  total: 0,
  passed: 0,
  failed: 0,
  details: []
};

function logTest(name, success, message, details = {}) {
  testResults.total++;
  if (success) {
    testResults.passed++;
    console.log(`✅ ${name}: ${message}`);
  } else {
    testResults.failed++;
    console.log(`❌ ${name}: ${message}`);
  }
  testResults.details.push({ name, success, message, details });
}

// Helper: Create ElevenLabs signature in NEW t=timestamp,h=hash format
function createElevenLabsSignature(payload, secret, timestamp) {
  const ts = timestamp || Math.floor(Date.now() / 1000);
  const signedPayload = `${ts}.${payload}`;
  const hash = crypto
    .createHmac('sha256', secret)
    .update(signedPayload, 'utf8')
    .digest('hex');
  return `t=${ts},h=${hash}`;
}

// Helper: Create Twilio signature (fixed format)
function createTwilioSignature(url, body, secret) {
  const signature = crypto
    .createHmac('sha1', secret)
    .update(url + body)
    .digest('base64');
  return signature; // Just the signature, no URL prefix
}

// Test 1: ElevenLabs new format validation
async function testElevenLabsNewFormat() {
  console.log('\n🧪 Testing ElevenLabs t=timestamp,h=hash format...');
  
  const payload = JSON.stringify({
    conversation_id: 'conv_test_' + Date.now(),
    agent_id: 'agent_test',
    status: 'completed',
    transcript: 'Test call transcript',
    caller_phone: '+15551234567'
  });
  
  const currentTimestamp = Math.floor(Date.now() / 1000);
  const validSignature = createElevenLabsSignature(payload, TEST_CONFIG.webhookSecret, currentTimestamp);
  
  try {
    const response = await fetch(`${TEST_CONFIG.baseUrl}/api/twilio/webhook/user3`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-ElevenLabs-Signature': validSignature,
        'User-Agent': 'ProductionReadinessTest/1.0'
      },
      body: payload
    });
    
    const statusOk = response.status === 200 || response.status === 400; // 400 is ok if no CallSid
    logTest(
      'ElevenLabs New Format', 
      statusOk, 
      `Expected 200/400, got ${response.status}. Signature format: ${validSignature.substring(0, 20)}...`
    );
    
  } catch (error) {
    logTest('ElevenLabs New Format', false, `Error: ${error.message}`);
  }
}

// Test 2: ElevenLabs replay protection
async function testElevenLabsReplayProtection() {
  console.log('\n🧪 Testing ElevenLabs replay protection...');
  
  const payload = JSON.stringify({
    conversation_id: 'conv_replay_test_' + Date.now(),
    agent_id: 'agent_test',
    status: 'completed'
  });
  
  const fixedTimestamp = Math.floor(Date.now() / 1000);
  const signature = createElevenLabsSignature(payload, TEST_CONFIG.webhookSecret, fixedTimestamp);
  
  try {
    // First request - should succeed
    const response1 = await fetch(`${TEST_CONFIG.baseUrl}/api/twilio/webhook/user3`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-ElevenLabs-Signature': signature,
        'User-Agent': 'ReplayTest/1.0'
      },
      body: payload
    });
    
    // Second request with same signature - should be rejected
    const response2 = await fetch(`${TEST_CONFIG.baseUrl}/api/twilio/webhook/user3`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-ElevenLabs-Signature': signature,
        'User-Agent': 'ReplayTest/1.0'
      },
      body: payload
    });
    
    const replayBlocked = response2.status === 403;
    logTest(
      'ElevenLabs Replay Protection', 
      replayBlocked, 
      `First: ${response1.status}, Second: ${response2.status} (should be 403)`
    );
    
  } catch (error) {
    logTest('ElevenLabs Replay Protection', false, `Error: ${error.message}`);
  }
}

// Test 3: Twilio signature validation (fixed format)
async function testTwilioSignatureValidation() {
  console.log('\n🧪 Testing Twilio signature validation (fixed format)...');
  
  const formData = 'CallSid=CAtest123&CallStatus=completed&From=%2B15551234567&To=%2B16155788171';
  const url = `${TEST_CONFIG.baseUrl}/api/twilio/webhook/user3`;
  const signature = createTwilioSignature(url, formData, TEST_CONFIG.webhookSecret);
  
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'X-Twilio-Signature': signature,
        'User-Agent': 'TwilioTest/1.0'
      },
      body: formData
    });
    
    const validationPassed = response.status !== 403;
    logTest(
      'Twilio Signature Fixed Format', 
      validationPassed, 
      `Status: ${response.status} (403 = signature failed)`
    );
    
  } catch (error) {
    logTest('Twilio Signature Fixed Format', false, `Error: ${error.message}`);
  }
}

// Test 4: Old ElevenLabs format rejection
async function testOldElevenLabsFormatRejection() {
  console.log('\n🧪 Testing old ElevenLabs format rejection...');
  
  const payload = JSON.stringify({
    conversation_id: 'conv_old_format_test',
    status: 'completed'
  });
  
  // Create old format signature
  const oldSignature = 'sha256=' + crypto
    .createHmac('sha256', TEST_CONFIG.webhookSecret)
    .update(payload)
    .digest('hex');
  
  try {
    const response = await fetch(`${TEST_CONFIG.baseUrl}/api/twilio/webhook/user3`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-ElevenLabs-Signature': oldSignature,
        'User-Agent': 'OldFormatTest/1.0'
      },
      body: payload
    });
    
    const rejectedOldFormat = response.status === 403;
    logTest(
      'Old ElevenLabs Format Rejection', 
      rejectedOldFormat, 
      `Status: ${response.status} (should be 403 for old format)`
    );
    
  } catch (error) {
    logTest('Old ElevenLabs Format Rejection', false, `Error: ${error.message}`);
  }
}

// Test 5: Rate limiting
async function testRateLimiting() {
  console.log('\n🧪 Testing rate limiting...');
  
  const payload = JSON.stringify({ test: 'rate_limit' });
  const promises = [];
  
  // Send 15 requests rapidly
  for (let i = 0; i < 15; i++) {
    promises.push(
      fetch(`${TEST_CONFIG.baseUrl}/api/twilio/webhook/user3`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-ElevenLabs-Signature': 't=1234567890,h=invalid_signature_' + i,
          'User-Agent': 'RateLimitTest/1.0'
        },
        body: payload
      })
    );
  }
  
  try {
    const responses = await Promise.all(promises);
    const rateLimited = responses.some(r => r.status === 429);
    const statusCodes = responses.map(r => r.status);
    
    logTest(
      'Rate Limiting', 
      rateLimited, 
      `Got 429 status: ${rateLimited}. Statuses: ${statusCodes.slice(0, 5).join(', ')}...`
    );
    
  } catch (error) {
    logTest('Rate Limiting', false, `Error: ${error.message}`);
  }
}

// Run all tests
async function runAllTests() {
  console.log('🚀 Starting Production Readiness Tests for Webhook Validation...\n');
  
  await testElevenLabsNewFormat();
  await testElevenLabsReplayProtection();
  await testTwilioSignatureValidation();
  await testOldElevenLabsFormatRejection();
  await testRateLimiting();
  
  console.log('\n📊 Test Results Summary:');
  console.log(`Total Tests: ${testResults.total}`);
  console.log(`Passed: ${testResults.passed}`);
  console.log(`Failed: ${testResults.failed}`);
  
  if (testResults.failed === 0) {
    console.log('\n🎉 All tests PASSED! Webhook validation system is production-ready.');
  } else {
    console.log('\n⚠️  Some tests FAILED. Review the issues above.');
    process.exit(1);
  }
}

runAllTests().catch(console.error);