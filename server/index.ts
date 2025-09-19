// server/index.ts - Use your real database system
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';

// Import your real routes and database functions
import { registerRoutes } from './routes'; // Adjust path to your main routes file
import { storage } from './storage';
import { db } from './db';
import { eq, desc, sql } from 'drizzle-orm';
import { calls } from '@shared/schema';

const app = express();
const PORT = process.env.PORT || 3000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('🚀 Starting server...');
console.log('Environment:', process.env.NODE_ENV);
console.log('Port:', PORT);

// Middleware
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    port: PORT
  });
});

// Enhanced Twilio webhook for real-time call logging
app.post('/webhooks/twilio/call-status', 
  express.urlencoded({ extended: false }), 
  async (req, res) => {
    try {
      console.log('Twilio webhook received');
      console.log('Body:', req.body);
      
      const {
        CallSid,
        CallStatus,
        From,
        To,
        Direction,
        Duration,
        CallDuration,
        StartTime,
        EndTime,
        CalledCity,
        CallerCity
      } = req.body;

      console.log('📞 Call Event:', {
        CallSid,
        CallStatus,
        From,
        To,
        Direction,
        Duration: Duration || CallDuration
      });

      // Map Twilio status to your database enum
      const mapStatus = (status: string) => {
        switch (status?.toLowerCase()) {
          case 'completed': return 'completed';
          case 'ringing':
          case 'answered': 
          case 'in-progress': return 'in-progress';
          case 'busy':
          case 'no-answer': return 'missed';
          default: return 'failed';
        }
      };

      const dbStatus = mapStatus(CallStatus);
      const callDuration = Duration ? parseInt(Duration) : (CallDuration ? parseInt(CallDuration) : null);

      // For user 3, we'll map the phone number you're using
      // You can expand this logic for other users
      let userId = null;
      
      // Check if this is for user 3's known phone number
      if (To === '+16156565526' || From === '+16156565526') {
        userId = 3;
      }
      
      if (userId) {
        // Check if call already exists
        const existingCall = await db.select()
          .from(calls)
          .where(eq(calls.twilioCallSid, CallSid))
          .limit(1);

        if (existingCall.length > 0) {
          // Update existing call
          await db.update(calls)
            .set({
              status: dbStatus,
              duration: callDuration,
              endTime: EndTime ? new Date(EndTime) : null
            })
            .where(eq(calls.id, existingCall[0].id));
          
          console.log(`✅ Updated call ${existingCall[0].id} for user ${userId}`);
        } else {
          // Create new call
          const [newCall] = await db.insert(calls).values({
            userId: userId,
            twilioCallSid: CallSid,
            phoneNumber: Direction === 'inbound' ? From : To,
            duration: callDuration,
            status: dbStatus,
            direction: Direction === 'inbound' ? 'inbound' : 'outbound',
            startTime: StartTime ? new Date(StartTime) : new Date(),
            endTime: EndTime ? new Date(EndTime) : null,
            createdAt: new Date(),
            notes: `Auto-logged from Twilio - ${CallerCity || CalledCity || 'Unknown location'}`,
            isFromTwilio: true
          }).returning();
          
          console.log(`✅ Created call ${newCall.id} for user ${userId}`);
        }
      } else {
        console.log(`❌ No user mapping for phone numbers: ${From} → ${To}`);
      }

      res.type('text/xml');
      res.send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
      
    } catch (error) {
      console.error('❌ Webhook error:', error);
      res.type('text/xml');
      res.send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
    }
  }
);

// Register all your real routes (auth, business, calls, etc.)
try {
  await registerRoutes(app);
  console.log('✅ All routes registered successfully');
} catch (error) {
  console.error('❌ Error registering routes:', error);
  
  // Fallback: Add essential routes manually if registerRoutes fails
  app.post('/api/auth/login', async (req, res) => {
    try {
      const user = await storage.validateUserCredentials(req.body);
      if (!user) {
        return res.status(401).json({ message: 'Invalid credentials' });
      }
      const { password, ...userWithoutPassword } = user;
      res.json({ message: 'Login successful', user: userWithoutPassword });
    } catch (error) {
      res.status(500).json({ message: 'Login failed' });
    }
  });

  app.get('/api/auth/user/:id', async (req, res) => {
    try {
      const user = await storage.getUser(parseInt(req.params.id));
      if (!user) {
        return res.status(404).json({ message: 'User not found' });
      }
      const { password, ...userWithoutPassword } = user;
      res.json({ data: userWithoutPassword });
    } catch (error) {
      res.status(500).json({ message: 'Failed to fetch user' });
    }
  });

  app.get('/api/calls/user/:userId', async (req, res) => {
    try {
      const userId = parseInt(req.params.userId);
      const limit = parseInt(req.query.limit as string) || 20;
      const offset = parseInt(req.query.offset as string) || 0;
      
      const totalCountResult = await db.select({ count: sql<number>`count(*)` })
        .from(calls)
        .where(eq(calls.userId, userId));
      const totalCount = totalCountResult[0]?.count || 0;
      
      const result = await db.select()
        .from(calls)
        .where(eq(calls.userId, userId))
        .orderBy(desc(calls.createdAt))
        .limit(limit)
        .offset(offset);
      
      console.log(`Retrieved ${result.length} calls for user ${userId}`);
      
      res.json({ 
        message: 'Calls retrieved successfully', 
        data: result,
        totalCount,
        limit,
        offset
      });
    } catch (error) {
      res.status(500).json({ message: 'Failed to fetch calls' });
    }
  });

  app.get('/api/business/:id', async (req, res) => {
    try {
      const business = await storage.getBusinessInfo(parseInt(req.params.id));
      res.json({ data: business });
    } catch (error) {
      res.status(500).json({ message: 'Failed to fetch business' });
    }
  });
}

// Static files
const publicPath = path.join(process.cwd(), 'dist', 'public');
app.use(express.static(publicPath, { fallthrough: true }));

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
    message: error.message
  });
});

// Start server
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Server started on port ${PORT}`);
  console.log(`🌐 https://aidash-upga.onrender.com`);
  console.log(`📞 Webhook: https://aidash-upga.onrender.com/webhooks/twilio/call-status`);
});

server.on('error', (error) => {
  console.error('❌ Server error:', error);
});
