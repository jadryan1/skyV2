const fetch = require('node-fetch');

async function testRegistration() {
  const testUser = {
    email: `test-${Date.now()}@example.com`,
    password: 'TestPassword123!',
    confirmPassword: 'TestPassword123!',
    businessName: 'Test Business',
    phoneNumber: '+1234567890',
    website: 'https://test.com',
    servicePlan: 'inbound',
    terms: true
  };

  try {
    console.log('Testing registration endpoint...');
    console.log('Test user:', testUser.email);
    
    const response = await fetch('http://localhost:5000/api/auth/register', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(testUser)
    });

    const result = await response.json();
    
    console.log('Response status:', response.status);
    console.log('Response body:', result);
    
    if (response.ok) {
      console.log('✅ Registration test passed!');
    } else {
      console.log('❌ Registration test failed:', result.message);
    }
  } catch (error) {
    console.error('❌ Test error:', error.message);
  }
}

testRegistration();
