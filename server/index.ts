// server/index.ts - Debug version with extensive logging
import express from 'express';
import path from 'path';

const app = express();
const PORT = process.env.PORT || 3000;

console.log('🚀 Starting server...');
console.log('Environment:', process.env.NODE_ENV);
console.log('Port:', PORT);
console.log('Working directory:', process.cwd());

// Middleware with logging
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Test endpoint first
app.get('/test', (req, res) => {
  console.log('Test endpoint hit');
  res.json({ 
    status: 'Server is working',
    timestamp: new Date().toISOString(),
    cwd: process.cwd(),
    env: process.env.NODE_ENV
  });
});

// Health check
app.get('/health', (req, res) => {
  console.log('Health check endpoint hit');
  res.json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    port: PORT,
    cwd: process.cwd()
  });
});

// Your existing API routes (make sure these are imported correctly)
// app.use('/api', yourApiRoutes);

// Check if dist directory exists
const distPath = path.join(process.cwd(), 'dist');
console.log('Checking dist directory:', distPath);

try {
  const fs = require('fs');
  if (fs.existsSync(distPath)) {
    console.log('✅ dist directory exists');
    const files = fs.readdirSync(distPath);
    console.log('Files in dist:', files);
    
    if (fs.existsSync(path.join(distPath, 'index.html'))) {
      console.log('✅ index.html found');
    } else {
      console.log('❌ index.html NOT found');
    }
  } else {
    console.log('❌ dist directory does not exist');
  }
} catch (error) {
  console.error('Error checking dist directory:', error);
}

// Serve static files with error handling
app.use(express.static(distPath, {
  fallthrough: true
}));

// Simple root route for testing
app.get('/', (req, res) => {
  console.log('Root route hit - attempting to serve index.html');
  
  try {
    const indexPath = path.join(distPath, 'index.html');
    console.log('Looking for index.html at:', indexPath);
    
    const fs = require('fs');
    if (fs.existsSync(indexPath)) {
      console.log('Serving index.html');
      res.sendFile(indexPath);
    } else {
      console.log('index.html not found, sending error');
      res.status(404).send(`
        <h1>Build files not found</h1>
        <p>Looking for: ${indexPath}</p>
        <p>Working directory: ${process.cwd()}</p>
        <p>Available routes:</p>
        <ul>
          <li><a href="/test">/test</a></li>
          <li><a href="/health">/health</a></li>
        </ul>
      `);
    }
  } catch (error) {
    console.error('Error in root route:', error);
    res.status(500).send(`Server error: ${error.message}`);
  }
});

// Twilio webhook
app.post('/webhooks/twilio/call-status', 
  express.urlencoded({ extended: false }), 
  (req, res) => {
    console.log('Twilio webhook received');
    console.log('Body:', req.body);
    
    res.type('text/xml');
    res.send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
  }
);

// Error handling
app.use((error, req, res, next) => {
  console.error('❌ Express Error:', error);
  console.error('Stack:', error.stack);
  res.status(500).json({ 
    error: 'Internal server error',
    message: error.message,
    timestamp: new Date().toISOString()
  });
});

// 404 handler
app.use((req, res) => {
  console.log('404 - Route not found:', req.path);
  res.status(404).json({ 
    error: 'Route not found',
    path: req.path,
    method: req.method
  });
});

// Start server with error handling
try {
  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Server successfully started on port ${PORT}`);
    console.log(`🌐 Access at: https://aidash-upga.onrender.com`);
    console.log(`🏥 Health check: https://aidash-upga.onrender.com/health`);
    console.log(`🧪 Test endpoint: https://aidash-upga.onrender.com/test`);
  });

  server.on('error', (error) => {
    console.error('❌ Server error:', error);
  });
} catch (error) {
  console.error('❌ Failed to start server:', error);
  process.exit(1);
}
