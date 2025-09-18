import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { wsManager } from "./wsManager";
import { 
  insertUserSchema, 
  loginUserSchema, 
  forgotPasswordSchema,
  callStatusEnum,
  calls
} from "@shared/schema";
import businessRoutes from "./routes/business";
import adminRoutes from "./adminRoutes";
import clientApiRoutes from "./routes/clientApi";
import apiKeyRoutes from "./routes/apiKeyRoutes";
import ragRoutes from "./routes/ragRoutes";
import { db } from "./db";
import { eq } from "drizzle-orm";
import crypto from "crypto";
import twilio from "twilio";

// SECURITY: Rate limiting for webhook endpoints
const webhookRequestCounts = new Map<string, { count: number; timestamp: number }>();
const RATE_LIMIT_WINDOW = 60 * 1000; // 1 minute
const RATE_LIMIT_MAX_REQUESTS = 100; // Max 100 requests per minute per IP

// SECURITY: Idempotency tracking for webhook processing
const processedWebhooks = new Map<string, number>();
const IDEMPOTENCY_TTL = 24 * 60 * 60 * 1000; // 24 hours

// SECURITY: ElevenLabs replay protection cache
const elevenLabsReplayCache = new Map<string, number>();
const ELEVENLABS_REPLAY_TTL = 5 * 60 * 1000; // 5 minutes

// SECURITY: ElevenLabs webhook signature validation with correct t=<timestamp>,h=<hash> format
function validateElevenLabsSignature(req: any, authToken: string): boolean {
  const clientIp = req.ip || req.connection.remoteAddress || 'unknown';
  const elevenLabsSignature = req.get('X-ElevenLabs-Signature');

  try {
    if (!elevenLabsSignature || elevenLabsSignature.trim() === '') {
      console.error(`🚫 SECURITY: Missing ElevenLabs signature header from IP ${clientIp}`);
      logSecurityEvent('MISSING_ELEVENLABS_SIGNATURE', clientIp, req.originalUrl);
      return false;
    }

    // Parse ElevenLabs signature format: t=<timestamp>,h=<hash>
    const signatureParts = elevenLabsSignature.split(',');
    if (signatureParts.length !== 2) {
      console.error(`🚫 SECURITY: Invalid ElevenLabs signature format from IP ${clientIp}`);
      logSecurityEvent('INVALID_ELEVENLABS_FORMAT', clientIp, elevenLabsSignature.substring(0, 20));
      return false;
    }

    // Extract timestamp and hash
    const timestampPart = signatureParts[0];
    const hashPart = signatureParts[1];

    if (!timestampPart.startsWith('t=') || !hashPart.startsWith('h=')) {
      console.error(`🚫 SECURITY: Invalid ElevenLabs signature parts from IP ${clientIp}`);
      logSecurityEvent('INVALID_ELEVENLABS_PARTS', clientIp, elevenLabsSignature.substring(0, 20));
      return false;
    }

    const timestamp = timestampPart.replace('t=', '');
    const providedHash = hashPart.replace('h=', '');

    // Validate timestamp format (should be numeric)
    if (!/^\d+$/.test(timestamp)) {
      console.error(`🚫 SECURITY: Invalid ElevenLabs timestamp format from IP ${clientIp}`);
      logSecurityEvent('INVALID_ELEVENLABS_TIMESTAMP', clientIp, timestamp);
      return false;
    }

    // Validate timestamp for replay protection (within 5 minutes)
    const timestampMs = parseInt(timestamp) * 1000;
    const now = Date.now();
    const TOLERANCE_MS = 5 * 60 * 1000; // 5 minutes

    if (Math.abs(now - timestampMs) > TOLERANCE_MS) {
      console.error(`🚫 SECURITY: ElevenLabs timestamp outside tolerance from IP ${clientIp}. Diff: ${Math.abs(now - timestampMs)}ms`);
      logSecurityEvent('ELEVENLABS_TIMESTAMP_OUT_OF_RANGE', clientIp, timestamp);
      return false;
    }

    // Validate hash format (should be 64 hex chars for SHA256)
    if (!/^[a-f0-9]{64}$/i.test(providedHash)) {
      console.error(`🚫 SECURITY: Invalid ElevenLabs hash format from IP ${clientIp}`);
      logSecurityEvent('INVALID_ELEVENLABS_HASH', clientIp, providedHash.substring(0, 20));
      return false;
    }

    // Compute expected signature using timestamp.request_body format
    const body = req.rawBody ? req.rawBody.toString('utf8') : 
                 (typeof req.body === 'string' ? req.body : JSON.stringify(req.body));
    const signedPayload = `${timestamp}.${body}`;
    
    const expectedHash = crypto
      .createHmac('sha256', authToken)
      .update(signedPayload, 'utf8')
      .digest('hex');

    // SECURITY: Use constant-time comparison to prevent timing attacks
    const isValid = crypto.timingSafeEqual(
      Buffer.from(providedHash, 'hex'),
      Buffer.from(expectedHash, 'hex')
    );

    console.log(`🔐 ElevenLabs HMAC validation from ${clientIp}: ${isValid ? 'VALID' : 'INVALID'}`);
    
    if (!isValid) {
      logSecurityEvent('INVALID_ELEVENLABS_SIGNATURE', clientIp, providedHash.substring(0, 20));
      return false;
    }

    // SECURITY: Check replay protection after validating signature
    if (!checkElevenLabsReplayProtection(timestamp, providedHash, clientIp)) {
      return false;
    }

    return isValid;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`🚫 SECURITY: ElevenLabs signature validation error from IP ${clientIp}:`, errorMessage);
    logSecurityEvent('ELEVENLABS_VALIDATION_ERROR', clientIp, errorMessage);
    return false;
  }
}

// SECURITY: Enhanced webhook signature validation with security best practices
function validateTwilioSignature(req: any, authToken?: string): boolean {
  const clientIp = req.ip || req.connection.remoteAddress || 'unknown';
  
  try {
    // Check for different signature headers (Twilio, ElevenLabs, etc.)
    const twilioSignature = req.get('X-Twilio-Signature');
    const elevenLabsSignature = req.get('X-ElevenLabs-Signature');
    const hubSignature = req.get('X-Hub-Signature');
    
    const signature = twilioSignature || elevenLabsSignature || hubSignature;
    
    // For Twilio webhooks, signature might not be present - allow without signature validation in development
    if (!signature || signature.trim() === '') {
      // In development/testing, allow webhooks without signatures for easier testing
      if (process.env.NODE_ENV === 'development' || process.env.ALLOW_UNSIGNED_WEBHOOKS === 'true') {
        console.warn(`⚠️ DEVELOPMENT: Allowing unsigned webhook from IP ${clientIp} for testing`);
        return true;
      }
      
      console.error(`🚫 SECURITY: Missing or empty signature header from IP ${clientIp}`);
      logSecurityEvent('MISSING_SIGNATURE', clientIp, req.originalUrl);
      return false;
    }

    // If we have an auth token, validate the HMAC signature
    if (authToken) {
      const crypto = require('crypto');
      
      // Handle ElevenLabs-style signatures (t=<timestamp>,h=<hash>)
      if (elevenLabsSignature) {
        return validateElevenLabsSignature(req, authToken);
      }
      
      // Handle Hub-style signatures (sha1=...)
      if (hubSignature) {
        if (!hubSignature.startsWith('sha1=')) {
          console.error(`🚫 SECURITY: Invalid Hub signature format from IP ${clientIp}`);
          logSecurityEvent('INVALID_SIGNATURE_FORMAT', clientIp, hubSignature.substring(0, 20));
          return false;
        }
        
        const providedSignature = hubSignature.replace('sha1=', '');
        const body = req.rawBody ? req.rawBody.toString('utf8') : 
                     (typeof req.body === 'string' ? req.body : JSON.stringify(req.body));
        const expectedSignature = crypto
          .createHmac('sha1', authToken)
          .update(body, 'utf8')
          .digest('base64');
        
        // SECURITY: Use constant-time comparison
        const isValid = crypto.timingSafeEqual(
          Buffer.from(providedSignature, 'base64'),
          Buffer.from(expectedSignature, 'base64')
        );
        
        console.log(`🔐 Hub HMAC validation from ${clientIp}: ${isValid ? 'VALID' : 'INVALID'}`);
        
        if (!isValid) {
          logSecurityEvent('INVALID_SIGNATURE', clientIp, providedSignature.substring(0, 20));
        }
        
        return isValid;
      }
      
      // Handle Twilio-style signatures (base64 encoded HMAC-SHA1)
      if (twilioSignature) {
        const url = req.protocol + '://' + req.get('host') + req.originalUrl;
        
        // CRITICAL FIX: Reconstruct the form-encoded body that Twilio signs
        let formEncodedBody = '';
        if (req.body && typeof req.body === 'object') {
          // Convert object to form-encoded string in alphabetical order (how Twilio does it)
          const sortedKeys = Object.keys(req.body).sort();
          const pairs: string[] = [];
          for (const key of sortedKeys) {
            pairs.push(`${encodeURIComponent(key)}=${encodeURIComponent(req.body[key])}`);
          }
          formEncodedBody = pairs.join('&');
        } else if (req.rawBody) {
          formEncodedBody = req.rawBody.toString('utf8');
        } else if (typeof req.body === 'string') {
          formEncodedBody = req.body;
        }
        
        const signatureData = url + formEncodedBody;
        const expectedSignature = crypto
          .createHmac('sha1', authToken)
          .update(signatureData, 'utf8')
          .digest('base64');
        
        console.log(`🔍 Twilio signature validation details:
          URL: ${url}
          Body: ${formEncodedBody.substring(0, 100)}...
          Expected: ${expectedSignature.substring(0, 20)}...
          Provided: ${twilioSignature.substring(0, 20)}...`);
        
        // SECURITY: Use constant-time comparison
        const isValid = crypto.timingSafeEqual(
          Buffer.from(twilioSignature, 'base64'),
          Buffer.from(expectedSignature, 'base64')
        );
        
        console.log(`🔐 Twilio HMAC validation from ${clientIp}: ${isValid ? 'VALID' : 'INVALID'}`);
        
        if (!isValid) {
          logSecurityEvent('INVALID_SIGNATURE', clientIp, twilioSignature.substring(0, 20));
        }
        
        return isValid;
      }
    } else {
      // No auth token provided - in development, allow for testing
      if (process.env.NODE_ENV === 'development' || process.env.ALLOW_UNSIGNED_WEBHOOKS === 'true') {
        console.warn(`⚠️ DEVELOPMENT: Allowing webhook without auth token from IP ${clientIp} for testing`);
        return true;
      }
    }

    // SECURITY: No fallback allowed in production
    console.error(`🚫 SECURITY: No valid signature method found from IP ${clientIp}`);
    logSecurityEvent('NO_VALID_SIGNATURE_METHOD', clientIp, signature ? signature.substring(0, 20) : 'none');
    return false;
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`🚫 SECURITY: Signature validation error from IP ${clientIp}:`, errorMessage);
    logSecurityEvent('SIGNATURE_VALIDATION_ERROR', clientIp, errorMessage);
    return false;
  }
}

// SECURITY: Security event logging for monitoring
const securityEventLog = new Map<string, { count: number; lastSeen: number }>();

function logSecurityEvent(eventType: string, clientIp: string, details: string) {
  const timestamp = Date.now();
  const logKey = `${eventType}-${clientIp}`;
  
  // Track event frequency per IP
  const existing = securityEventLog.get(logKey) || { count: 0, lastSeen: 0 };
  existing.count++;
  existing.lastSeen = timestamp;
  securityEventLog.set(logKey, existing);
  
  // Log security event
  console.warn(`🚨 SECURITY EVENT: ${eventType} from IP ${clientIp} (count: ${existing.count}) - ${details}`);
  
  // Cleanup old entries (older than 1 hour)
  const oneHourAgo = timestamp - (60 * 60 * 1000);
  for (const [key, data] of securityEventLog.entries()) {
    if (data.lastSeen < oneHourAgo) {
      securityEventLog.delete(key);
    }
  }
  
  // Alert on repeated failures from same IP
  if (existing.count >= 5) {
    console.error(`🚨 HIGH SECURITY ALERT: ${existing.count} failed attempts from IP ${clientIp} for event type ${eventType}`);
  }
}

// SECURITY: Rate limiting middleware for webhooks
function rateLimitWebhook(req: Request, res: Response, next: any) {
  const clientIp = req.ip || req.connection.remoteAddress || 'unknown';
  const now = Date.now();
  
  // Clean up old entries
  for (const [ip, data] of webhookRequestCounts.entries()) {
    if (now - data.timestamp > RATE_LIMIT_WINDOW) {
      webhookRequestCounts.delete(ip);
    }
  }
  
  // Check rate limit
  const clientData = webhookRequestCounts.get(clientIp) || { count: 0, timestamp: now };
  
  if (now - clientData.timestamp > RATE_LIMIT_WINDOW) {
    // Reset window
    clientData.count = 1;
    clientData.timestamp = now;
  } else {
    clientData.count++;
  }
  
  webhookRequestCounts.set(clientIp, clientData);
  
  if (clientData.count > RATE_LIMIT_MAX_REQUESTS) {
    console.warn(`Rate limit exceeded for IP ${clientIp}`);
    return res.status(429).json({ error: 'Rate limit exceeded' });
  }
  
  next();
}

// SECURITY: Idempotency check for webhooks
function checkIdempotency(callSid: string, eventType: string): boolean {
  const key = `${callSid}-${eventType}`;
  const now = Date.now();
  
  // Clean up old entries
  for (const [k, timestamp] of processedWebhooks.entries()) {
    if (now - timestamp > IDEMPOTENCY_TTL) {
      processedWebhooks.delete(k);
    }
  }
  
  if (processedWebhooks.has(key)) {
    console.log(`Duplicate webhook ignored: ${key}`);
    return false;
  }
  
  processedWebhooks.set(key, now);
  return true;
}

// SECURITY: ElevenLabs replay protection using timestamp + signature
function checkElevenLabsReplayProtection(timestamp: string, signature: string, clientIp: string): boolean {
  const key = `${timestamp}-${signature.substring(0, 16)}`; // Use timestamp + signature prefix
  const now = Date.now();
  
  // Clean up old entries (older than 5 minutes)
  for (const [k, cacheTime] of elevenLabsReplayCache.entries()) {
    if (now - cacheTime > ELEVENLABS_REPLAY_TTL) {
      elevenLabsReplayCache.delete(k);
    }
  }
  
  if (elevenLabsReplayCache.has(key)) {
    console.error(`🚫 SECURITY: ElevenLabs replay attack detected from IP ${clientIp}. Key: ${key}`);
    logSecurityEvent('ELEVENLABS_REPLAY_ATTACK', clientIp, key);
    return false;
  }
  
  elevenLabsReplayCache.set(key, now);
  return true;
}

// SECURITY: Per-client webhook secret management
function getClientWebhookSecret(clientId: string): string | null {
  // Check for client-specific environment variable (e.g., WEBHOOK_SECRET_CLIENT_1)
  const clientSecretEnvVar = `WEBHOOK_SECRET_CLIENT_${clientId.toUpperCase()}`;
  const clientSecret = process.env[clientSecretEnvVar];
  
  if (clientSecret) {
    console.log(`🔐 Using client-specific secret for client: ${clientId}`);
    return clientSecret;
  }
  
  // Fall back to backward compatibility with USER3_TWILIO_AUTH_TOKEN for client "3" or "user3"
  if (clientId === '3' || clientId.toLowerCase() === 'user3') {
    const fallbackSecret = process.env.USER3_TWILIO_AUTH_TOKEN;
    if (fallbackSecret) {
      console.log(`🔐 Using backward compatibility secret for client: ${clientId}`);
      return fallbackSecret;
    }
  }
  
  // No secret found for this client
  console.warn(`⚠️  No webhook secret found for client: ${clientId}`);
  return null;
}

// SECURITY: Extract client ID from webhook request
function extractClientIdFromRequest(req: any): string | null {
  // Try to extract client ID from URL path
  const pathParts = req.originalUrl.split('/');
  
  // Look for patterns like /api/twilio/webhook/user3 or /api/webhook/client-123
  const webhookIndex = pathParts.findIndex((part: string) => part === 'webhook');
  if (webhookIndex !== -1 && webhookIndex + 1 < pathParts.length) {
    const clientPart = pathParts[webhookIndex + 1];
    
    // Handle user3 format
    if (clientPart.startsWith('user')) {
      return clientPart.replace('user', '');
    }
    
    // Handle client-X format
    if (clientPart.startsWith('client-') || clientPart.startsWith('client_')) {
      return clientPart.replace(/^client[-_]/, '');
    }
    
    // Return as-is if it looks like a client ID
    return clientPart;
  }
  
  // Try to extract from headers
  const clientIdHeader = req.get('X-Client-ID') || req.get('X-Client-Id');
  if (clientIdHeader) {
    return clientIdHeader;
  }
  
  // Try to extract from query parameters
  if (req.query.client_id || req.query.clientId) {
    return req.query.client_id || req.query.clientId;
  }
  
  // Default fallback - could be removed for stricter security
  console.warn(`⚠️  Could not determine client ID from request: ${req.originalUrl}`);
  return null;
}

// SECURITY: Enhanced webhook signature validation with per-client secrets
function validateTwilioSignatureForClient(req: any, clientId?: string, authToken?: string): boolean {
  const clientIp = req.ip || req.connection.remoteAddress || 'unknown';
  
  try {
    // Determine the client ID if not provided
    const resolvedClientId = clientId || extractClientIdFromRequest(req);
    
    // Get the appropriate auth token for this client
    let resolvedAuthToken = authToken;
    
    if (!resolvedAuthToken && resolvedClientId) {
      const clientSecret = getClientWebhookSecret(resolvedClientId);
      resolvedAuthToken = clientSecret || undefined;
    }
    
    // If still no token, log the security event
    if (!resolvedAuthToken) {
      console.error(`🚫 SECURITY: No webhook secret available for client ${resolvedClientId || 'unknown'} from IP ${clientIp}`);
      logSecurityEvent('NO_CLIENT_SECRET', clientIp, resolvedClientId || 'unknown');
      return false;
    }
    
    // Use the existing validateTwilioSignature function with the resolved token
    const isValid = validateTwilioSignature(req, resolvedAuthToken);
    
    if (isValid) {
      console.log(`✅ SECURITY: Valid webhook signature for client ${resolvedClientId || 'unknown'} from IP ${clientIp}`);
    } else {
      console.warn(`🚫 SECURITY: Invalid webhook signature for client ${resolvedClientId || 'unknown'} from IP ${clientIp}`);
      logSecurityEvent('INVALID_CLIENT_SIGNATURE', clientIp, resolvedClientId || 'unknown');
    }
    
    return isValid;
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`🚫 SECURITY: Client webhook validation error from IP ${clientIp}:`, errorMessage);
    logSecurityEvent('CLIENT_VALIDATION_ERROR', clientIp, errorMessage);
    return false;
  }
}

// Export validator functions for testing
export { 
  validateElevenLabsSignature,
  validateTwilioSignature,
  validateTwilioSignatureForClient,
  checkIdempotency,
  checkElevenLabsReplayProtection,
  logSecurityEvent,
  rateLimitWebhook
};

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





  // Twilio webhook endpoint to receive real call data
  // Twilio webhook endpoint - processes calls for all users based on their phone numbers
  // Primary Twilio webhook for call logging (works alongside ElevenLabs)

  // Secondary webhook specifically for logging calls while ElevenLabs handles voice

  // Webhook for Twilio recording completion

  // SECURITY HARDENED: Webhook for Twilio transcription completion  
  app.post("/api/twilio/transcription", rateLimitWebhook, async (req: Request, res: Response) => {
    try {
      // SECURITY: Validate Twilio signature with per-client secrets
      if (!validateTwilioSignatureForClient(req)) {
        console.error('Invalid Twilio signature for transcription webhook');
        return res.status(403).json({ error: 'Invalid signature' });
      }

      console.log("📝 Transcription webhook received:", req.body);
      
      const { CallSid, TranscriptionStatus } = req.body;
      
      // SECURITY: Idempotency check
      if (!checkIdempotency(CallSid, `transcription-${TranscriptionStatus}`)) {
        return res.status(200).send("DUPLICATE_IGNORED");
      }
      
      const { twilioService } = await import("./twilioService");
      await twilioService.processTranscriptionWebhook(req.body);
      
      // SECURITY: Fast 200 response
      res.status(200).send("OK");
    } catch (error) {
      console.error("Error processing transcription webhook:", error);
      // SECURITY: Still return 200 to prevent Twilio retries that could cause DoS
      res.status(200).send("ERROR_LOGGED");
    }
  });

  // Raw body parsing middleware for webhook signature validation
  app.use('/api/twilio/webhook', (req: Request, res: Response, next: any) => {
    req.rawBody = '';
    req.setEncoding('utf8');
    
    req.on('data', (chunk: string) => {
      req.rawBody += chunk;
    });
    
    req.on('end', () => {
      next();
    });
  });

  // ENHANCED USER3 WEBHOOK: Full transcript + audio recording capture with HMAC security
  // This webhook captures ALL call data for user 3 with proper authentication
  app.post("/api/twilio/webhook/user3", rateLimitWebhook, async (req: Request, res: Response) => {
    try {
      console.log("🎯 USER3 ENHANCED: Received webhook data for user 3:", JSON.stringify(req.body, null, 2));
      
      const { CallSid, CallStatus, TranscriptionStatus, TranscriptionText, RecordingUrl, From, To, Direction } = req.body;
      
      // SECURITY: Validate HMAC signature for user 3 using per-client validation
      if (!validateTwilioSignatureForClient(req, '3')) {
        console.error('🚫 USER3 ENHANCED: Invalid HMAC signature - rejecting request');
        return res.status(403).json({ error: 'Invalid signature' });
      }
      
      // Enhanced logging for debugging
      console.log(`🎯 USER3 ENHANCED: CallSid: ${CallSid}, Status: ${CallStatus}, From: ${From}, To: ${To}, Direction: ${Direction}`);
      console.log(`📝 USER3 ENHANCED: Transcript: ${TranscriptionText ? `${TranscriptionText.length} chars` : 'None'}`);
      console.log(`🎵 USER3 ENHANCED: Recording: ${RecordingUrl ? 'Available' : 'None'}`);
      
      // SECURITY: Idempotency check with proper null checks
      const eventType = TranscriptionStatus ? `transcription-${TranscriptionStatus}` : `call-${CallStatus || 'unknown'}`;
      if (CallSid && !checkIdempotency(CallSid, eventType)) {
        console.log(`🎯 USER3 ENHANCED: Duplicate webhook ignored for CallSid: ${CallSid}`);
        return res.status(200).send("DUPLICATE_IGNORED");
      }
      
      // Process ALL call events to capture complete data
      const { twilioService } = await import("./twilioService");
      
      // **ENHANCED PROCESSING**: Capture full transcripts and audio recordings
      await twilioService.processUser3CallWebhookEnhanced(req.body);
      
      console.log("✅ USER3 ENHANCED: Successfully processed webhook with full data capture");
      
      // IMPORTANT: Return 200 with no TwiML content to ensure we don't interfere with calls
      // This webhook is for data collection only
      res.status(200).send("DATA_CAPTURED");
    } catch (error) {
      console.error("❌ USER3 ENHANCED: Error processing webhook for user 3:", error);
      // SECURITY: Always return 200 to Twilio to avoid retries affecting call flow
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

  // Twilio webhook endpoints for real-time call tracking
  
  // General Twilio webhook endpoint for all users

  // Dedicated webhook endpoint for user 3 - captures ALL calls regardless of phone number

  // Twilio recording webhook endpoint

  // Twilio transcription webhook endpoint

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
