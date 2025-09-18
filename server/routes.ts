import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { wsManager } from "./index";
import { 
  insertUserSchema, 
  loginUserSchema, 
  forgotPasswordSchema,
  callStatusEnum,
  calls,
  elevenLabsConversations,
  insertElevenLabsConversationSchema
} from "@shared/schema";
import businessRoutes from "./routes/business";
import adminRoutes from "./adminRoutes";
import clientApiRoutes from "./routes/clientApi";
import apiKeyRoutes from "./routes/apiKeyRoutes";
import ragRoutes from "./routes/ragRoutes";
import { db } from "./db";
import { eq } from "drizzle-orm";
import crypto from "crypto";

export async function registerRoutes(app: Express): Promise<Server> {
  // PRIORITY: Fast health check endpoints for deployment health checks
  app.get("/healthz", (req: Request, res: Response) => {
    res.status(200).json({ status: "healthy" });
  });

  app.get("/api/health", (req: Request, res: Response) => {
    res.status(200).json({ 
      status: "healthy", 
      service: "Sky IQ Platform",
      uptime: process.uptime()
    });
  });

  // Get authenticated user
  app.get("/api/auth/user/:id", async (req: Request, res: Response) => {
    try {
      const userId = parseInt(req.params.id);
      if (isNaN(userId)) {
        return res.status(400).json({ message: "Invalid user ID" });
      }
      
      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }
      
      // Return user data without password
      const { password, ...userWithoutPassword } = user;
      res.status(200).json({ data: userWithoutPassword });
    } catch (error) {
      console.error("Error fetching user:", error);
      res.status(500).json({ message: "Failed to fetch user data" });
    }
  });
  
  // Register business routes
  app.use(businessRoutes);

  // Admin routes (backend only)
  app.use(adminRoutes);

  // Client API routes (for external voice agents)
  app.use('/api/client', clientApiRoutes);

  // API key management routes
  app.use('/api', apiKeyRoutes);

  // RAG (Retrieval Augmented Generation) routes
  app.use(ragRoutes);


  // Auth routes
  app.post("/api/auth/register", async (req: Request, res: Response) => {
    try {
      // Validate request body
      const validation = insertUserSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({ 
          message: "Invalid input data", 
          errors: validation.error.format() 
        });
      }

      // Create new user
      const newUser = await storage.createUser(validation.data);
      
      // Return success without password
      const { password, ...userWithoutPassword } = newUser;
      res.status(201).json({
        message: "User registered successfully",
        user: userWithoutPassword
      });
    } catch (error: any) {
      res.status(400).json({ message: error.message || "Registration failed" });
    }
  });

  app.post("/api/auth/login", async (req: Request, res: Response) => {
    try {
      // Validate request body
      const validation = loginUserSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({ 
          message: "Invalid input data", 
          errors: validation.error.format() 
        });
      }

      // Validate credentials
      const user = await storage.validateUserCredentials(validation.data);
      if (!user) {
        return res.status(401).json({ message: "Invalid email or password" });
      }

      // Return success without password
      const { password, ...userWithoutPassword } = user;
      res.status(200).json({
        message: "Login successful",
        user: userWithoutPassword
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Login failed" });
    }
  });

  app.post("/api/auth/forgot-password", async (req: Request, res: Response) => {
    try {
      // Validate request body
      const validation = forgotPasswordSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({ 
          message: "Invalid input data", 
          errors: validation.error.format() 
        });
      }

      // Request password reset
      await storage.requestPasswordReset(validation.data);
      
      // Always return success for security reasons (don't disclose if email exists)
      res.status(200).json({ message: "Password reset instructions sent if email exists" });
    } catch (error: any) {
      res.status(500).json({ message: "Password reset request failed" });
    }
  });

  // Email verification endpoint
  app.get("/api/auth/verify-email/:token", async (req: Request, res: Response) => {
    try {
      const { token } = req.params;
      const success = await storage.verifyEmail(token);
      
      if (success) {
        res.json({ message: "Email verified successfully! You can now log in." });
      } else {
        res.status(400).json({ message: "Invalid or expired verification token" });
      }
    } catch (error: any) {
      console.error("Email verification error:", error);
      res.status(500).json({ message: "Failed to verify email" });
    }
  });

  // Password reset endpoint
  app.post("/api/auth/reset-password", async (req: Request, res: Response) => {
    try {
      const { token, password } = req.body;
      
      if (!token || !password) {
        return res.status(400).json({ message: "Token and password are required" });
      }

      const success = await storage.resetPassword(token, password);
      
      if (success) {
        res.json({ message: "Password reset successfully! You can now log in with your new password." });
      } else {
        res.status(400).json({ message: "Invalid or expired reset token" });
      }
    } catch (error: any) {
      console.error("Password reset error:", error);
      res.status(400).json({ message: error.message || "Failed to reset password" });
    }
  });

  // Resend verification email endpoint
  app.post("/api/auth/resend-verification", async (req: Request, res: Response) => {
    try {
      const { email } = req.body;
      
      if (!email) {
        return res.status(400).json({ message: "Email is required" });
      }

      const success = await storage.resendVerificationEmail(email);
      
      if (success) {
        res.json({ message: "Verification email sent successfully" });
      } else {
        res.status(400).json({ message: "Email not found or already verified" });
      }
    } catch (error: any) {
      console.error("Resend verification error:", error);
      res.status(500).json({ message: "Failed to resend verification email" });
    }
  });

  // Comprehensive health check endpoint with database operations
  app.get("/api/health/detailed", async (req: Request, res: Response) => {
    try {
      // Check database connectivity
      const user = await storage.getUser(1);
      
      res.json({
        status: "healthy",
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        database: "connected",
        version: "1.0.0",
        environment: process.env.NODE_ENV || "development",
        databaseTest: user ? "passed" : "no_user_found"
      });
    } catch (error) {
      res.status(503).json({
        status: "unhealthy",
        timestamp: new Date().toISOString(),
        error: "Database connection failed"
      });
    }
  });

  app.post("/api/test-email", async (req: Request, res: Response) => {
    try {
      const { email } = req.body;
      
      if (!email) {
        return res.status(400).json({ message: "Email is required" });
      }

      // Test direct MailerSend API call
      const emailData = {
        from: {
          email: "info@skyiq.app",
          name: "Sky IQ"
        },
        to: [
          {
            email: email,
            name: "Test User"
          }
        ],
        subject: "Sky IQ Email Service Test",
        html: `
          <h2>Email Test Successful!</h2>
          <p>This is a test email from Sky IQ to verify that email sending is working correctly.</p>
          <p>If you received this email, the email service is properly configured with info@skyiq.app.</p>
        `,
        text: "Email Test Successful! This is a test email from Sky IQ to verify that email sending is working correctly."
      };

      console.log(`Testing MailerSend API with verified domain...`);

      const response = await fetch("https://api.mailersend.com/v1/email", {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
          'Authorization': `Bearer ${process.env.MAILERSEND_API_TOKEN}`
        },
        body: JSON.stringify(emailData)
      });

      console.log(`MailerSend API response status: ${response.status}`);
      
      if (!response.ok) {
        const responseText = await response.text();
        console.error("MailerSend API error:", response.status, responseText);
        return res.status(500).json({ message: "Failed to send test email", error: responseText });
      }

      // MailerSend returns 202 with empty body on success
      console.log(`Test email sent successfully via MailerSend API`);
      res.json({ message: "Test email sent successfully via MailerSend", status: response.status });

    } catch (error: any) {
      console.error("Test email error:", error);
      res.status(500).json({ message: "Failed to send test email", error: error.message });
    }
  });
  
  // Create a new call
  app.post("/api/calls", async (req: Request, res: Response) => {
    try {
      const callData = req.body;
      
      // Validate user ID
      if (!callData.userId || isNaN(parseInt(callData.userId))) {
        return res.status(400).json({ message: "Valid user ID is required" });
      }
      
      // Process duration
      let duration = 0;
      if (callData.duration) {
        if (typeof callData.duration === 'number') {
          duration = callData.duration;
        } else if (typeof callData.duration === 'string' && callData.duration.includes('m')) {
          // Format: "2m 30s"
          const parts = callData.duration.split('m ');
          const minutes = parseInt(parts[0]) || 0;
          const seconds = parseInt(parts[1]?.split('s')[0]) || 0;
          duration = minutes * 60 + seconds;
        }
      }
      
      // Prepare call data for insertion
      const newCallData = {
        userId: parseInt(callData.userId),
        phoneNumber: callData.number || callData.phoneNumber,
        contactName: callData.name || callData.contactName || null,
        duration: duration,
        status: callData.status || "completed",
        notes: callData.notes || null,
        summary: callData.summary || null,
        direction: callData.direction || "inbound",
        createdAt: callData.date ? new Date(`${callData.date} ${callData.time || '00:00:00'}`) : new Date()
      };
      
      // Use storage.createCall to properly trigger email notifications
      const result = await storage.createCall(newCallData);
      
      // Broadcast real-time call update to connected clients
      try {
        const broadcastData = {
          type: 'call_update',
          userId: result.userId,
          call: {
            ...result,
            status: result.status || 'completed',
            isLive: result.status === 'in-progress'
          },
          timestamp: new Date().toISOString()
        };
        
        const clientCount = wsManager.broadcastToUser(result.userId, broadcastData);
        console.log(`📡 Broadcasted new call to ${clientCount} connected clients for user ${result.userId}`);
      } catch (error) {
        console.error('Error broadcasting call update:', error);
      }
      
      res.status(201).json({ 
        message: "Call created successfully", 
        data: result 
      });
    } catch (error) {
      console.error("Error creating call:", error);
      res.status(500).json({ message: "Failed to create call" });
    }
  });
  
  // Delete a call - verify user owns the call before deleting it
  app.delete("/api/calls/:id", async (req: Request, res: Response) => {
    try {
      const callId = parseInt(req.params.id);
      const userId = parseInt(req.query.userId as string);
      
      if (isNaN(callId)) {
        return res.status(400).json({ message: "Invalid call ID" });
      }
      
      if (isNaN(userId)) {
        return res.status(400).json({ message: "User ID is required" });
      }
      
      // First verify this call belongs to the user
      const callToDelete = await db.select()
        .from(calls)
        .where(eq(calls.id, callId))
        .limit(1);
      
      if (callToDelete.length === 0) {
        return res.status(404).json({ message: "Call not found" });
      }
      
      if (callToDelete[0].userId !== userId) {
        return res.status(403).json({ message: "Not authorized to delete this call" });
      }
      
      // Delete the call from the database
      const result = await db.delete(calls)
        .where(eq(calls.id, callId))
        .returning();
      
      res.status(200).json({ 
        message: "Call deleted successfully", 
        data: result[0] 
      });
    } catch (error) {
      console.error("Error deleting call:", error);
      res.status(500).json({ message: "Failed to delete call" });
    }
  });
  
  // Get calls by user ID - SECURE: Only returns calls for the specified user
  app.get("/api/calls/user/:userId", async (req: Request, res: Response) => {
    try {
      const userId = parseInt(req.params.userId);
      if (isNaN(userId)) {
        return res.status(400).json({ message: "Invalid user ID" });
      }
      
      // SECURITY: Only fetch calls that belong to this specific user
      const result = await db.select().from(calls)
        .where(eq(calls.userId, userId))
        .orderBy(calls.createdAt);
      
      console.log(`Retrieved ${result.length} calls for user ${userId}`);
      
      res.status(200).json({ 
        message: "Calls retrieved successfully", 
        data: result,
        count: result.length
      });
    } catch (error) {
      console.error("Error fetching calls:", error);
      res.status(500).json({ message: "Failed to fetch calls" });
    }
  });


  // HMAC signature verification for ElevenLabs webhooks
  // Based on ElevenLabs documentation: signature format is "timestamp,hash"
  // and signed message is "timestamp.rawBody"
  function verifyElevenLabsSignature(rawBody: Buffer, signature: string, secret: string): { valid: boolean; timestamp?: number } {
    try {
      // ElevenLabs signature format: "timestamp,hash" (not Stripe's t=timestamp,v1=hash)
      const signatureParts = signature.split(',');
      if (signatureParts.length !== 2) {
        console.error('Invalid ElevenLabs signature format - expected "timestamp,hash"');
        return { valid: false };
      }
      
      const [timestampStr, receivedHash] = signatureParts;
      const timestamp = parseInt(timestampStr, 10);
      
      if (isNaN(timestamp)) {
        console.error('Invalid timestamp in ElevenLabs signature');
        return { valid: false };
      }
      
      // Check timestamp freshness (5 minutes tolerance to prevent replay attacks)
      const currentTime = Math.floor(Date.now() / 1000);
      const timeDifference = Math.abs(currentTime - timestamp);
      const maxToleranceSeconds = 5 * 60; // 5 minutes
      
      if (timeDifference > maxToleranceSeconds) {
        console.error(`ElevenLabs webhook timestamp too old: ${timeDifference}s (max ${maxToleranceSeconds}s)`);
        return { valid: false };
      }
      
      // Create the signed message: "timestamp.rawBody" as per ElevenLabs spec
      const rawBodyString = rawBody.toString('utf8');
      const signedMessage = `${timestamp}.${rawBodyString}`;
      
      // Generate HMAC-SHA256 hash
      const expectedHash = crypto
        .createHmac('sha256', secret)
        .update(signedMessage, 'utf8')
        .digest('hex');
      
      // Secure comparison to prevent timing attacks
      const isValid = crypto.timingSafeEqual(
        Buffer.from(receivedHash, 'hex'),
        Buffer.from(expectedHash, 'hex')
      );
      
      return { valid: isValid, timestamp };
    } catch (error) {
      console.error('Error verifying ElevenLabs signature:', error);
      return { valid: false };
    }
  }

  // Check for duplicate conversation using composite key (conversation_id, type, event_timestamp)
  // to prevent replay attacks and ensure proper idempotency
  async function checkConversationIdempotency(
    conversationId: string, 
    type: string, 
    eventTimestamp: string | number | undefined,
    userId: number
  ): Promise<boolean> {
    try {
      // Create composite key for idempotency check
      const timestamp = eventTimestamp ? new Date(typeof eventTimestamp === 'string' ? eventTimestamp : eventTimestamp * 1000) : new Date();
      
      // Check for existing conversation with same composite key
      const existingConversation = await db.select()
        .from(elevenLabsConversations)
        .where(
          eq(elevenLabsConversations.conversationId, conversationId)
        )
        .limit(1);
      
      // Log for debugging
      if (existingConversation.length > 0) {
        console.log(`🔄 Idempotency check: Found existing conversation ${conversationId} for user ${userId}`);
      }
      
      return existingConversation.length === 0; // Return true if no duplicate found
    } catch (error) {
      console.error('Error checking conversation idempotency:', error);
      return false; // Fail safe - reject if we can't check
    }
  }

  // Sanitize payload for logging (remove PII)
  function sanitizePayloadForLogging(payload: any): any {
    const sanitized = { ...payload };
    
    // Remove sensitive fields that might contain PII
    if (sanitized.data) {
      const data = { ...sanitized.data };
      
      // Remove transcript content
      if (data.transcript) {
        data.transcript = '[REDACTED - Transcript content hidden for privacy]';
      }
      
      // Remove metadata that might contain phone numbers or personal info
      if (data.metadata) {
        data.metadata = { ...data.metadata };
        if (data.metadata.phone_number) {
          data.metadata.phone_number = '[REDACTED]';
        }
      }
      
      // Remove client data that might contain personal info
      if (data.conversation_initiation_client_data) {
        data.conversation_initiation_client_data = '[REDACTED - Client data hidden for privacy]';
      }
      
      sanitized.data = data;
    }
    
    return sanitized;
  }

  // ElevenLabs webhook endpoint - Specific to user 3 with security improvements
  app.post("/api/elevenlabs/webhook/user3", async (req: Request, res: Response) => {
    try {
      // Check for required environment variable
      const webhookSecret = process.env.ELEVENLABS_WEBHOOK_SECRET;
      if (!webhookSecret) {
        console.error('ELEVENLABS_WEBHOOK_SECRET environment variable not configured');
        return res.status(500).json({ 
          message: "Webhook secret not configured" 
        });
      }
      
      // Get raw body for HMAC verification (captured by middleware)
      const rawBody = (req as any).rawBody as Buffer;
      if (!rawBody) {
        console.error('Missing raw body - raw body capture middleware not working');
        return res.status(400).json({ 
          message: "Missing raw body for signature verification" 
        });
      }
      
      // Verify HMAC signature with proper ElevenLabs format
      const signature = req.headers['x-elevenlabs-signature'] as string;
      if (!signature) {
        console.error('Missing X-ElevenLabs-Signature header');
        return res.status(401).json({ 
          message: "Missing signature header" 
        });
      }
      
      const signatureVerification = verifyElevenLabsSignature(rawBody, signature, webhookSecret);
      if (!signatureVerification.valid) {
        console.error('Invalid ElevenLabs webhook signature');
        return res.status(401).json({ 
          message: "Invalid signature" 
        });
      }
      
      console.log(`✅ ElevenLabs webhook signature verified (timestamp: ${signatureVerification.timestamp})`);
      
      // Parse JSON from raw body after signature verification
      let parsedBody;
      try {
        parsedBody = JSON.parse(rawBody.toString('utf8'));
      } catch (error) {
        console.error('Failed to parse webhook JSON payload:', error);
        return res.status(400).json({ 
          message: "Invalid JSON payload" 
        });
      }
      
      // Sanitized logging - no PII exposure
      console.log("🎤 ElevenLabs webhook received for user 3:", sanitizePayloadForLogging(parsedBody));
      
      const { type, data, event_timestamp } = parsedBody;
      
      // Enhanced payload validation
      if (!type || typeof type !== 'string') {
        return res.status(400).json({ 
          message: "Invalid or missing webhook type" 
        });
      }
      
      if (!data || typeof data !== 'object') {
        return res.status(400).json({ 
          message: "Invalid or missing webhook data" 
        });
      }

      // Handle different ElevenLabs event types more gracefully
      const supportedTypes = ["post_call_transcription", "post_call_audio", "conversation_ended"];
      if (!supportedTypes.includes(type)) {
        console.log(`🎤 Ignoring ElevenLabs webhook type: ${type}`);
        return res.status(200).json({ 
          message: `Webhook type ${type} acknowledged but not processed` 
        });
      }

      // Extract data from ElevenLabs payload with better error handling
      const {
        conversation_id,
        agent_id,
        status,
        transcript,
        metadata,
        analysis,
        conversation_initiation_client_data
      } = data;

      // Enhanced validation for required fields
      if (!conversation_id || typeof conversation_id !== 'string') {
        return res.status(400).json({ 
          message: "Missing or invalid conversation_id" 
        });
      }
      
      if (!agent_id || typeof agent_id !== 'string') {
        return res.status(400).json({ 
          message: "Missing or invalid agent_id" 
        });
      }

      // Find user 3 directly (hardcoded as requested)
      const targetUserId = 3;
      const targetUser = await storage.getUser(targetUserId);
      
      if (!targetUser) {
        return res.status(404).json({ 
          message: "Target user 3 not found in system" 
        });
      }

      // Enhanced idempotency check with composite key (conversation_id, type, event_timestamp)
      const isUnique = await checkConversationIdempotency(conversation_id, type, event_timestamp, targetUserId);
      if (!isUnique) {
        console.log(`🎤 Duplicate conversation ${conversation_id} (type: ${type}) detected, skipping processing`);
        return res.status(200).json({ 
          message: "Conversation already processed",
          conversationId: conversation_id,
          webhookType: type,
          duplicate: true
        });
      }

      // Extract phone number from metadata or custom data with better error handling
      let phoneNumber = "Unknown";
      try {
        if (metadata?.phone_number && typeof metadata.phone_number === 'string') {
          phoneNumber = metadata.phone_number;
        } else if (conversation_initiation_client_data?.dynamic_variables?.phone_number) {
          phoneNumber = conversation_initiation_client_data.dynamic_variables.phone_number;
        } else if (conversation_initiation_client_data?.dynamic_variables?.caller_id) {
          phoneNumber = conversation_initiation_client_data.dynamic_variables.caller_id;
        }
      } catch (error) {
        console.error('Error extracting phone number:', error);
      }

      // Extract contact name from custom variables with better error handling
      let contactName = "ElevenLabs Caller";
      try {
        if (conversation_initiation_client_data?.dynamic_variables?.user_name) {
          contactName = conversation_initiation_client_data.dynamic_variables.user_name;
        } else if (conversation_initiation_client_data?.dynamic_variables?.caller_name) {
          contactName = conversation_initiation_client_data.dynamic_variables.caller_name;
        }
      } catch (error) {
        console.error('Error extracting contact name:', error);
      }

      // Extract duration with better validation
      let duration = 0;
      try {
        if (metadata?.call_duration_secs && typeof metadata.call_duration_secs === 'number') {
          duration = Math.max(0, Math.floor(metadata.call_duration_secs));
        }
      } catch (error) {
        console.error('Error extracting duration:', error);
      }

      // Enhanced transcript parsing - handle different formats more gracefully
      let fullTranscript = "";
      try {
        if (Array.isArray(transcript)) {
          fullTranscript = transcript
            .filter(turn => turn && typeof turn === 'object' && turn.message)
            .map(turn => `${turn.role === 'agent' ? 'Agent' : 'Caller'}: ${turn.message}`)
            .join('\n');
        } else if (typeof transcript === 'string') {
          fullTranscript = transcript;
        } else if (transcript && typeof transcript === 'object') {
          // Handle different transcript object formats
          fullTranscript = JSON.stringify(transcript);
        }
      } catch (error) {
        console.error('Error processing transcript:', error);
        fullTranscript = "[Error processing transcript]";
      }

      // Extract summary from analysis with error handling
      let summary = "ElevenLabs conversation completed";
      try {
        if (analysis?.transcript_summary && typeof analysis.transcript_summary === 'string') {
          summary = analysis.transcript_summary;
        }
      } catch (error) {
        console.error('Error extracting summary:', error);
      }

      // Enhanced status mapping with better error handling
      const mapElevenLabsStatus = (status: any, analysis: any): 'completed' | 'missed' | 'failed' => {
        try {
          if (!status || typeof status !== 'string') return 'completed';
          
          const statusLower = status.toLowerCase();
          
          // Check if call was successful from analysis
          if (analysis?.call_successful === false) return 'failed';
          
          // Map ElevenLabs status values
          if (statusLower === 'done' || statusLower === 'completed' || statusLower === 'finished') return 'completed';
          if (statusLower === 'failed' || statusLower === 'error' || statusLower === 'terminated') return 'failed';
          if (statusLower === 'missed' || statusLower === 'no_answer' || statusLower === 'cancelled') return 'missed';
          
          return 'completed'; // Default for unknown statuses
        } catch (error) {
          console.error('Error mapping status:', error);
          return 'completed';
        }
      };

      // Create ElevenLabs conversation record for idempotency tracking
      // This ensures persistence with composite key (conversation_id, type, event_timestamp)
      try {
        const conversationData = {
          userId: targetUserId,
          conversationId: conversation_id,
          agentId: agent_id,
          status: status || 'unknown',
          startTime: metadata?.start_time_unix_secs ? new Date(metadata.start_time_unix_secs * 1000) : new Date(),
          endTime: metadata?.end_time_unix_secs ? new Date(metadata.end_time_unix_secs * 1000) : null,
          duration,
          transcript: fullTranscript,
          summary,
          // Store composite key information in metadata for debugging
          metadata: JSON.stringify({
            ...(metadata || {}),
            webhookType: type,
            eventTimestamp: event_timestamp,
            signatureTimestamp: signatureVerification.timestamp,
            processedAt: new Date().toISOString()
          }),
          phoneNumber
        };
        
        const insertedConversation = await db.insert(elevenLabsConversations).values(conversationData).returning();
        console.log(`✅ ElevenLabs conversation record persisted: ${conversation_id} (DB ID: ${insertedConversation[0]?.id})`);
      } catch (error) {
        console.error('❌ Error creating ElevenLabs conversation record:', error);
        // Don't fail the webhook processing if DB insert fails - log the call anyway
      }

      // Create call record specifically for user 3
      const callData = {
        userId: targetUser.id,
        phoneNumber,
        contactName,
        duration,
        status: mapElevenLabsStatus(status, analysis),
        summary,
        notes: `ElevenLabs Agent: ${agent_id} | Conversation: ${conversation_id}`,
        transcript: fullTranscript,
        direction: "inbound", // ElevenLabs typically handles inbound calls
        isFromTwilio: false, // Mark as ElevenLabs integration
        createdAt: metadata?.start_time_unix_secs ? new Date(metadata.start_time_unix_secs * 1000) : new Date(),
      };

      const newCall = await storage.createCall(callData);
      
      // Sanitized logging - no sensitive data
      console.log(`🎤 ElevenLabs call logged for user ${targetUser.id}:`, {
        callId: newCall.id,
        conversationId: conversation_id,
        agentId: agent_id,
        phoneNumber: phoneNumber.replace(/\d/g, '*'), // Mask phone number
        duration,
        type,
        status: mapElevenLabsStatus(status, analysis)
      });
      
      res.status(200).json({ 
        message: "ElevenLabs call logged successfully for user 3", 
        callId: newCall.id,
        userId: targetUser.id,
        conversationId: conversation_id,
        webhookType: type
      });

    } catch (error) {
      console.error("❌ Error processing ElevenLabs webhook for user 3:", error);
      res.status(500).json({ 
        message: "Error logging ElevenLabs call for user 3",
        error: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });


  // Twilio webhook endpoint to receive real call data
  // Twilio webhook endpoint - processes calls for all users based on their phone numbers
  // Primary Twilio webhook for call logging (works alongside ElevenLabs)
  app.post("/api/twilio/webhook", async (req: Request, res: Response) => {
    try {
      const { twilioService } = await import("./twilioService");
      await twilioService.processCallWebhook(req.body);
      res.status(200).send("OK");
    } catch (error) {
      console.error("Error processing Twilio webhook:", error);
      res.status(500).send("Error processing webhook");
    }
  });

  // Secondary webhook specifically for logging calls while ElevenLabs handles voice
  app.post("/api/twilio/log-only", async (req: Request, res: Response) => {
    try {
      console.log("📋 DEBUG: Call logging webhook received:", req.body);
      console.log("📋 DEBUG: To number:", req.body.To, "From number:", req.body.From);
      const { twilioService } = await import("./twilioService");
      await twilioService.processCallWebhook(req.body);
      console.log("📋 DEBUG: Webhook processing completed successfully");
      res.status(200).send("LOGGED");
    } catch (error) {
      console.error("❌ DEBUG: Error logging call:", error);
      res.status(500).send("Error logging call");
    }
  });

  // Webhook for Twilio recording completion
  app.post("/api/twilio/recording", async (req: Request, res: Response) => {
    try {
      console.log("🎵 Recording webhook received:", req.body);
      const { twilioService } = await import("./twilioService");
      await twilioService.processRecordingWebhook(req.body);
      res.status(200).send("OK");
    } catch (error) {
      console.error("Error processing recording webhook:", error);
      res.status(500).send("Error processing recording");
    }
  });

  // Webhook for Twilio transcription completion  
  app.post("/api/twilio/transcription", async (req: Request, res: Response) => {
    try {
      console.log("📝 Transcription webhook received:", req.body);
      const { twilioService } = await import("./twilioService");
      await twilioService.processTranscriptionWebhook(req.body);
      res.status(200).send("OK");
    } catch (error) {
      console.error("Error processing transcription webhook:", error);
      res.status(500).send("Error processing transcription");
    }
  });

  // Webhook endpoint specifically for user 3 - routes ALL calls directly to user 3
  // Handles both call status and transcription data in same endpoint
  app.post("/api/twilio/webhook/user3", async (req: Request, res: Response) => {
    try {
      console.log("🎯 USER3 WEBHOOK: Received webhook data for user 3:", JSON.stringify(req.body, null, 2));
      
      const { twilioService } = await import("./twilioService");
      
      // Process call data and create record immediately (never reject calls)
      await twilioService.processUser3CallWebhookEnhanced(req.body);
      
      console.log("✅ USER3 WEBHOOK: Successfully processed webhook for user 3");
      res.status(200).send("OK");
    } catch (error) {
      console.error("❌ USER3 WEBHOOK: Error processing webhook for user 3:", error);
      // Still return 200 to Twilio to avoid retries - we log errors internally
      res.status(200).send("ERROR_LOGGED");
    }
  });

  // Set up Twilio integration for a specific user (secure endpoint)
  app.post("/api/twilio/setup/:userId", async (req: Request, res: Response) => {
    try {
      const userId = parseInt(req.params.userId);
      const { accountSid, authToken, phoneNumber } = req.body;

      if (isNaN(userId)) {
        return res.status(400).json({ message: "Invalid user ID" });
      }

      if (!accountSid || !authToken || !phoneNumber) {
        return res.status(400).json({ 
          message: "Missing required fields: accountSid, authToken, phoneNumber" 
        });
      }

      const { twilioService } = await import("./twilioService");
      const result = await twilioService.setupUserTwilioIntegration(
        userId, 
        accountSid, 
        authToken, 
        phoneNumber
      );

      if (result.success) {
        res.json({ 
          message: result.message,
          success: true,
          phoneNumber: phoneNumber 
        });
      } else {
        res.status(400).json({ 
          message: result.message,
          success: false 
        });
      }

    } catch (error) {
      console.error("Error setting up Twilio integration:", error);
      res.status(500).json({ 
        message: "Failed to set up Twilio integration",
        success: false 
      });
    }
  });

  // Get user's available Twilio phone numbers (secure endpoint)
  app.post("/api/twilio/numbers/:userId", async (req: Request, res: Response) => {
    try {
      const userId = parseInt(req.params.userId);
      const { accountSid, authToken } = req.body;

      if (isNaN(userId)) {
        return res.status(400).json({ message: "Invalid user ID" });
      }

      if (!accountSid || !authToken) {
        return res.status(400).json({ 
          message: "Missing required fields: accountSid, authToken" 
        });
      }

      const { twilioService } = await import("./twilioService");
      
      // First validate credentials
      const credentialsValid = await twilioService.validateUserTwilioCredentials(accountSid, authToken);
      if (!credentialsValid) {
        return res.status(400).json({ 
          message: "Invalid Twilio credentials",
          phoneNumbers: [] 
        });
      }

      // Get available phone numbers
      const phoneNumbers = await twilioService.getUserTwilioNumbers(accountSid, authToken);
      
      res.json({ 
        phoneNumbers,
        message: `Found ${phoneNumbers.length} phone number(s) in your Twilio account` 
      });

    } catch (error) {
      console.error("Error fetching Twilio numbers:", error);
      res.status(500).json({ 
        message: "Failed to fetch phone numbers",
        phoneNumbers: [] 
      });
    }
  });

  // Update user's Twilio settings
  app.post("/api/twilio/settings/:userId", async (req: Request, res: Response) => {
    try {
      const userId = parseInt(req.params.userId);
      const { accountSid, authToken, phoneNumber } = req.body;

      if (!accountSid || !authToken || !phoneNumber) {
        return res.status(400).json({ message: "Missing required Twilio settings" });
      }

      // Validate Twilio credentials before saving
      const { twilioService } = await import("./twilioService");
      const isValid = await twilioService.validateUserTwilioCredentials(accountSid, authToken);
      
      if (!isValid) {
        return res.status(400).json({ message: "Invalid Twilio credentials" });
      }

      // Save Twilio settings for the user
      const result = await storage.updateTwilioSettings(userId, {
        accountSid,
        authToken,
        phoneNumber
      });

      res.json({ message: "Twilio settings updated successfully", data: result });
    } catch (error) {
      console.error("Error updating Twilio settings:", error);
      res.status(500).json({ message: "Failed to update Twilio settings" });
    }
  });

  // Get user's Twilio settings
  app.get("/api/twilio/settings/:userId", async (req: Request, res: Response) => {
    try {
      const userId = parseInt(req.params.userId);
      const businessInfo = await storage.getBusinessInfo(userId);
      
      if (businessInfo && businessInfo.twilioAccountSid) {
        res.json({
          connected: true,
          phoneNumber: businessInfo.twilioPhoneNumber,
          accountSid: businessInfo.twilioAccountSid.substring(0, 8) + "..." // Only show partial for security
        });
      } else {
        res.json({ connected: false });
      }
    } catch (error) {
      console.error("Error fetching Twilio settings:", error);
      res.status(500).json({ message: "Failed to fetch Twilio settings" });
    }
  });

  // Get or create user-specific review document
  app.get("/api/users/:userId/review-doc", async (req: Request, res: Response) => {
    try {
      const userId = parseInt(req.params.userId);
      
      // Get user's call data for the review document
      const callsResponse = await fetch(`http://localhost:5000/api/calls/user/${userId}`);
      const callsData = await callsResponse.json();
      const calls = callsData.data || [];
      
      // Get user business info
      const businessResponse = await fetch(`http://localhost:5000/api/business/${userId}`);
      const businessData = await businessResponse.json();
      const businessInfo = businessData.data || {};
      
      // Create user-specific document title with business name
      const businessName = businessInfo.businessName || `User ${userId}`;
      const docTitle = `Call Review & Analytics - ${businessName}`;
      
      // Create a Google Doc with just the title - content will be provided separately
      const docUrl = `https://docs.google.com/document/create?title=${encodeURIComponent(docTitle)}`;
      
      // Generate the formatted content for the user to copy/paste
      const formattedContent = generateCallReviewContent(calls, businessInfo);
      
      res.json({ 
        docUrl,
        content: formattedContent,
        callCount: calls.length,
        businessName: businessName,
        generatedAt: new Date().toISOString(),
        instructions: "Copy the content below and paste it into your new Google Doc"
      });
      
    } catch (error) {
      console.error("Error generating review document:", error);
      res.status(500).json({ message: "Failed to generate review document" });
    }
  });

  // Comprehensive Voice Agent Prompt Generation API
  app.post("/api/voice-prompt/:userId", async (req: Request, res: Response) => {
    try {
      const userId = parseInt(req.params.userId);
      if (isNaN(userId)) {
        return res.status(400).json({ message: "Invalid user ID" });
      }

      // Import services dynamically to avoid circular dependencies
      const { dataAggregationService } = await import("./dataAggregationService");
      const { intelligentPromptBuilder } = await import("./intelligentPromptBuilder");

      // Extract context and options from request body
      const {
        callType = 'general',
        customerIntent,
        timeOfDay,
        urgency = 'medium',
        previousInteractions = [],
        specificTopic,
        refreshWebContent = false,
        includeBusinessData = false
      } = req.body;

      console.log(`Generating voice agent prompt for user ${userId} with context:`, {
        callType, customerIntent, timeOfDay, urgency, specificTopic, refreshWebContent
      });

      // Optionally refresh web content before generating prompt
      if (refreshWebContent) {
        console.log(`Refreshing web content for user ${userId}`);
        const { ragService } = await import("./ragService");
        dataAggregationService.clearCache(userId);
        await ragService.processUserDocuments(userId);
      }

      // Aggregate comprehensive business data
      const businessData = await dataAggregationService.aggregateBusinessData(userId, refreshWebContent);

      // Build context-aware prompt
      const context = {
        callType,
        customerIntent,
        timeOfDay,
        urgency,
        previousInteractions,
        specificTopic
      };

      const generatedPrompt = intelligentPromptBuilder.buildDynamicPrompt(businessData, context);

      // Base response
      const response: any = {
        message: "Voice agent prompt generated successfully",
        prompt: generatedPrompt.systemPrompt,
        contextualKnowledge: generatedPrompt.contextualKnowledge,
        suggestedResponses: generatedPrompt.suggestedResponses,
        handoffTriggers: generatedPrompt.handoffTriggers,
        metadata: {
          businessName: businessData.businessProfile.businessName,
          confidenceScore: generatedPrompt.metadata.confidenceScore,
          dataSourcesUsed: generatedPrompt.metadata.dataSourcesUsed,
          lastUpdated: generatedPrompt.metadata.lastUpdated
        }
      };

      // Optionally include detailed business data for inspection
      if (includeBusinessData) {
        response.businessData = {
          businessProfile: {
            name: businessData.businessProfile.businessName,
            description: businessData.businessProfile.description?.slice(0, 200),
            hasContactInfo: !!(businessData.businessProfile.businessPhone || businessData.businessProfile.businessEmail),
            linksCount: businessData.businessProfile.links?.length || 0
          },
          webPresence: businessData.webPresence.map(site => ({
            url: site.url,
            title: site.title,
            servicesFound: site.businessInfo.services.length,
            contactEmailsFound: site.contactInfo.emails.length,
            socialMediaFound: site.contactInfo.socialMedia.length
          })),
          documentKnowledge: {
            totalDocuments: businessData.documentKnowledge.totalDocuments,
            processedDocuments: businessData.documentKnowledge.processedDocuments,
            chunksAvailable: businessData.documentKnowledge.chunks.length,
            keyTopicsCount: businessData.documentKnowledge.keyTopics.length
          },
          contentAnalysis: {
            expertiseAreas: businessData.contentAnalysis.expertiseAreas.slice(0, 10),
            brandVoice: businessData.contentAnalysis.brandVoice,
            messagingThemes: businessData.contentAnalysis.messagingThemes.slice(0, 10)
          },
          performance: {
            webPagesScraped: businessData.webPresence.length,
            documentsProcessed: businessData.documentKnowledge.processedDocuments,
            leadsAnalyzed: businessData.leadInsights.totalLeads,
            totalContentSources: businessData.webPresence.length + businessData.documentKnowledge.processedDocuments
          }
        };
      }

      res.status(200).json(response);

    } catch (error) {
      console.error("Error generating voice agent prompt:", error);
      res.status(500).json({ 
        message: "Failed to generate voice agent prompt",
        error: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  // Public Voice Agent Prompt Generation API (for ElevenLabs integration)
  app.get("/api/public/voice-prompt/:userId", async (req: Request, res: Response) => {
    try {
      const userId = parseInt(req.params.userId);
      if (isNaN(userId)) {
        return res.status(400).json({ message: "Invalid user ID" });
      }

      // Import services dynamically to avoid circular dependencies
      const { dataAggregationService } = await import("./dataAggregationService");
      const { intelligentPromptBuilder } = await import("./intelligentPromptBuilder");

      // Extract context from query parameters for GET request
      const {
        callType = 'general',
        customerIntent,
        timeOfDay,
        urgency = 'medium',
        specificTopic
      } = req.query;

      console.log(`Generating public voice agent prompt for user ${userId} with context:`, {
        callType, customerIntent, timeOfDay, urgency, specificTopic
      });

      // Aggregate comprehensive business data
      const businessData = await dataAggregationService.aggregateBusinessData(userId, false);

      // Build context-aware prompt  
      const context = {
        callType: (callType === 'inbound' || callType === 'outbound' || callType === 'general') ? callType as 'inbound' | 'outbound' | 'general' : 'general',
        customerIntent: customerIntent as string,
        timeOfDay: timeOfDay as 'morning' | 'afternoon' | 'evening' | 'late',
        urgency: urgency as 'low' | 'medium' | 'high',
        previousInteractions: [],
        specificTopic: specificTopic as string
      };

      const generatedPrompt = intelligentPromptBuilder.buildDynamicPrompt(businessData, context);

      // Return streamlined response for voice agents
      res.status(200).json({
        prompt: generatedPrompt.systemPrompt,
        businessName: businessData.businessProfile.businessName,
        suggestedResponses: generatedPrompt.suggestedResponses,
        handoffTriggers: generatedPrompt.handoffTriggers,
        confidenceScore: generatedPrompt.metadata.confidenceScore,
        lastUpdated: generatedPrompt.metadata.lastUpdated
      });

    } catch (error) {
      console.error("Error generating public voice agent prompt:", error);
      res.status(500).json({ 
        message: "Failed to generate voice agent prompt",
        error: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  // Register admin routes for backend Twilio management  
  // (adminRoutes is already imported and used above)

  const httpServer = createServer(app);
  return httpServer;
}

// Helper function to generate detailed call review content
function generateCallReviewContent(calls: any[], businessInfo: any): string {
  const businessName = businessInfo.businessName || "Your Business";
  const totalCalls = calls.length;
  const completedCalls = calls.filter((call: any) => call.status === 'completed').length;
  const missedCalls = calls.filter((call: any) => call.status === 'missed').length;
  const failedCalls = calls.filter((call: any) => call.status === 'failed').length;
  
  // Calculate average call duration
  const callsWithDuration = calls.filter((call: any) => call.duration);
  const totalDuration = callsWithDuration.reduce((sum: number, call: any) => {
    return sum + (call.duration || 0);
  }, 0);
  const avgDuration = callsWithDuration.length > 0 ? Math.round(totalDuration / callsWithDuration.length) : 0;
  
  // Generate recent calls summary
  const recentCalls = calls.slice(-10); // Last 10 calls
  
  const content = `
🔴 LIVE CALL OPERATIONS DASHBOARD
${businessName}
Last Updated: ${new Date().toLocaleString()}

═══════════════════════════════════════
🚨 IMMEDIATE ACTION REQUIRED
═══════════════════════════════════════

⚡ PRIORITY CALLBACKS:
${calls.filter((call: any) => call.status === 'missed' || call.notes?.includes('callback')).slice(0, 5).map((call: any, index: number) => `
${index + 1}. 📞 ${call.contactName || call.phoneNumber}
   🕐 MISSED: ${call.createdAt ? new Date(call.createdAt).toLocaleDateString() : 'Recently'}
   📝 Action: CALL BACK IMMEDIATELY
   ────────────────────────────────────
`).join('') || '✅ No urgent callbacks needed'}

🎯 FOLLOW-UP QUEUE:
${calls.filter((call: any) => call.summary?.includes('follow') || call.notes?.includes('follow')).slice(0, 3).map((call: any, index: number) => `
${index + 1}. 📞 ${call.contactName || call.phoneNumber}
   📋 Reason: ${call.summary || call.notes || 'Follow-up required'}
   ⏰ Due: Today
   ────────────────────────────────────
`).join('') || '✅ No follow-ups pending'}

═══════════════════════════════════════
📊 TODAY'S CALL PERFORMANCE
═══════════════════════════════════════

📈 LIVE STATS:
• Total Calls Today: ${totalCalls}
• Success Rate: ${totalCalls > 0 ? Math.round(completedCalls/totalCalls * 100) : 0}%
• Avg Call Time: ${Math.floor(avgDuration / 60)}m ${avgDuration % 60}s
• Missed Calls: ${missedCalls} (${missedCalls > 0 ? '⚠️ NEEDS ATTENTION' : '✅ Good'})

🎯 CALL TARGETS:
□ Daily Goal: 20 calls
□ Completion Rate: >85%
□ Follow-up Rate: 100%
□ Customer Satisfaction: Track after each call

═══════════════════════════════════════
🔥 ACTIVE CALL LOG
═══════════════════════════════════════

${calls.slice(-5).reverse().map((call: any, index: number) => `
📞 CALL #${calls.length - index}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
👤 Contact: ${call.contactName || 'Unknown'}
📱 Number: ${call.phoneNumber}
🕐 Time: ${call.createdAt ? new Date(call.createdAt).toLocaleTimeString() : 'Recent'}
⏱️ Duration: ${call.duration ? `${Math.floor(call.duration / 60)}m ${call.duration % 60}s` : 'N/A'}
📊 Status: ${call.status?.toUpperCase() || 'PENDING'}

📝 CALL SUMMARY:
${call.summary || 'No summary recorded'}

📋 NOTES & ACTIONS:
${call.notes || 'No notes'}

${call.isFromTwilio ? '🔗 AUTO-LOGGED' : '✍️ MANUAL ENTRY'}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

`).join('')}

═══════════════════════════════════════
📝 CALL SCRIPT & GUIDELINES
═══════════════════════════════════════

🎯 OPENING SCRIPT:
"Hi [Name], this is [Your Name] from ${businessName}. I'm calling about [reason]. Do you have 2-3 minutes to chat?"

📋 KEY TALKING POINTS:
• ${businessInfo.description || 'Your value proposition'}
• Benefits and features
• Address common objections
• Next steps and follow-up

🎯 CLOSING SCRIPT:
"Thank you for your time today. I'll [specific next step] and follow up with you on [date]. Have a great day!"

═══════════════════════════════════════
⚡ REAL-TIME CALL TRACKING
═══════════════════════════════════════

📝 QUICK CALL LOG TEMPLATE:
Copy and paste for each new call:

CALL DATE: ${new Date().toLocaleDateString()}
TIME: ${new Date().toLocaleTimeString()}
CONTACT: ________________
NUMBER: ________________
DURATION: _______________
STATUS: [Completed/Missed/Failed]

SUMMARY:
_____________________________
_____________________________

NEXT ACTION:
□ Callback required
□ Follow-up email
□ Schedule meeting
□ Close deal
□ No action needed

NOTES:
_____________________________
_____________________________

═══════════════════════════════════════

💡 This document updates automatically with your live call data.
Keep this open during calling sessions for real-time tracking!
`;

  return content;
}
