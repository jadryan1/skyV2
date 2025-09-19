// server/index.ts - Fixed with ES6 imports and correct paths
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { existsSync, readdirSync } from 'fs'; // ES6 import instead of require

const app = express();
const PORT = process.env.PORT || 3000;

// Fix for ES modules __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('🚀 Starting server...');
console.log('Environment:', process.env.NODE_ENV);
console.log('Port:', PORT);
console.log('Working directory:', process.cwd());
console.log('__dirname:', __dirname);

// Middleware with logging
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Based on your build output, files are in dist/public/
const publicPath = path.join(process.cwd(), 'dist', 'public');
console.log('Looking for static files in:', publicPath);

// Check if directories exist
try {
  if (existsSync(publicPath)) {
    console.log('✅ dist/public directory exists');
    const files = readdirSync(publicPath);
    console.log('Files in dist/public:', files);
    
    if (existsSync(path.join(publicPath, 'index.html'))) {
      console.log('✅ index.html found in dist/public');
    } else {
      console.log('❌ index.html NOT found in dist/public');
    }
  } else {
    console.log('❌ dist/public directory does not exist');
    
    // Check if files are in dist/ instead
    const distPath = path.join(process.cwd(), 'dist');
    if (existsSync(distPath)) {
      console.log('Checking dist/ directory:', readdirSync(distPath));
    }
  }
} catch (error) {
  console.error('Error checking directories:', error);
}

// Health check
app.get('/health', (req, res) => {
  console.log('Health check endpoint hit');
  res.json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    port: PORT,
    publicPath,
    files: existsSync(publicPath) ? readdirSync(publicPath) : 'Directory not found'
  });
});

// Test endpoint
app.get('/test', (req, res) => {
  console.log('Test endpoint hit');
  res.json({ 
    status: 'Server is working',
    timestamp: new Date().toISOString(),
    cwd: process.cwd(),
    publicPath,
    indexExists: existsSync(path.join(publicPath, 'index.html'))
  });
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

// Import your existing API routes (adjust paths as needed)
// You need to find where these are defined and import them
// Example imports:
// import authRoutes from './routes/auth.js';
// import callsRoutes from './routes/calls.js';
// import businessRoutes from './routes/business.js';

// Temporary API routes for testing - replace with your actual routes
app.post('/api/auth/login', (req, res) => {
  console.log('Login attempt:', req.body);
  const { email, password } = req.body;
  
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password required' });
  }
  
  // Replace this with your actual authentication logic
  res.json({
    message: 'Login successful',
    user: {
      id: 3,
      email: email,
      name: 'Test User'
    }
  });
});

app.get('/api/auth/user/:id', (req, res) => {
  console.log('Get user:', req.params.id);
  res.json({
    data: {
      id: parseInt(req.params.id),
      email: "audamaur@gmail.com",
      name: "Test User"
    }
  });
});

app.get('/api/calls/user/:id', (req, res) => {
  console.log('Get calls for user:', req.params.id);
  res.json({
    message: "Calls retrieved successfully",
    data: [],
    total: 0
  });
});

app.post('/api/calls', (req, res) => {
  console.log('Create call:', req.body);
  res.json({
    message: "Call created successfully",
    data: {
      id: Date.now(),
      ...req.body,
      createdAt: new Date().toISOString()
    }
  });
});

app.put('/api/calls/:id', (req, res) => {
  console.log('Update call:', req.params.id, req.body);
  res.json({
    message: "Call updated successfully",
    data: {
      id: req.params.id,
      ...req.body,
      updatedAt: new Date().toISOString()
    }
  });
});

app.delete('/api/calls/:id', (req, res) => {
  console.log('Delete call:', req.params.id);
  res.json({
    message: "Call deleted successfully"
  });
});

app.get('/api/business/:id', (req, res) => {
  console.log('Get business:', req.params.id);
  res.json({
    data: {
      id: 13,
      userId: parseInt(req.params.id),
      businessName: "Test Business"
    }
  });
});

// Add your actual API routes here:
// app.use('/api/auth', authRoutes);
// app.use('/api/calls', callsRoutes);
// app.use('/api/business', businessRoutes);

// Serve static files from the correct location
app.use(express.static(publicPath, {
  fallthrough: true
}));

// Root route
app.get('/', (req, res) => {
  console.log('Root route hit - attempting to serve index.html');
  
  try {
    const indexPath = path.join(publicPath, 'index.html');
    console.log('Looking for index.html at:', indexPath);
    
    if (existsSync(indexPath)) {
      console.log('Serving index.html');
      res.sendFile(indexPath);
    } else {
      console.log('index.html not found, sending debug info');
      res.status(404).send(`
        <h1>Debug Info</h1>
        <p><strong>Looking for:</strong> ${indexPath}</p>
        <p><strong>Working directory:</strong> ${process.cwd()}</p>
        <p><strong>Public path:</strong> ${publicPath}</p>
        <p><strong>Public path exists:</strong> ${existsSync(publicPath)}</p>
        <p><strong>Available routes:</strong></p>
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

// Catch-all for React Router
app.get('*', (req, res) => {
  console.log('Catch-all route for:', req.path);
  
  try {
    const indexPath = path.join(publicPath, 'index.html');
    
    if (existsSync(indexPath)) {
      res.sendFile(indexPath);
    } else {
      res.status(404).send('App not found');
    }
  } catch (error) {
    console.error('Error in catch-all route:', error);
    res.status(500).send(`Server error: ${error.message}`);
  }
});

// Error handling
app.use((error, req, res, next) => {
  console.error('❌ Express Error:', error);
  res.status(500).json({ 
    error: 'Internal server error',
    message: error.message,
    timestamp: new Date().toISOString()
  });
});

// Start server
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
