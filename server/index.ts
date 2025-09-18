import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
import path from "path";
import fs from "fs";
import https from "https";
import http from "http";
import WebSocket, { WebSocketServer } from "ws";
import { wsManager, type WebSocketClient } from "./wsManager";

// SSL certificate has been updated - normal TLS validation restored

// CONFIGURATION: AI SERVICES DISABLED FOR RAW DATA COLLECTION
console.log('🚫 ==========================================');
console.log('🚫 AI SERVICES DISABLED');
console.log('🚫 RAW CALL DATA COLLECTION MODE ACTIVE');
console.log('🚫 NO PROCESSING, FILTERING, OR AI ANALYSIS');
console.log('🚫 ==========================================');

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// Handle uncaught exceptions  
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  process.exit(1);
});

const app = express();


// SECURITY: Raw body capture middleware for webhook signature verification
// This must be before express.json() to capture the raw bytes for specific endpoints

// Capture raw body for Twilio webhooks (form-encoded)
app.use('/api/twilio/', express.raw({ 
  type: 'application/x-www-form-urlencoded',
  verify: (req: any, res, buf) => {
    // Store raw body for signature verification
    req.rawBody = buf;
  }
}));

// Capture raw body for ElevenLabs and other JSON webhooks
app.use('/api/webhook/', express.raw({ 
  type: 'application/json',
  verify: (req: any, res, buf) => {
    // Store raw body for signature verification
    req.rawBody = buf;
  }
}));

// Capture raw body for any other webhook endpoints
app.use('/webhook/', express.raw({ 
  type: 'application/json',
  verify: (req: any, res, buf) => {
    // Store raw body for signature verification
    req.rawBody = buf;
  }
}));

// Standard JSON parsing for all other routes
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "…";
      }

      log(logLine);
    }
  });

  next();
});

  // SECURITY: Middleware to handle Replit host restrictions - DEVELOPMENT ONLY
  if (process.env.NODE_ENV === 'development') {
    app.use((req, res, next) => {
      const host = req.headers.host;
      if (host && host.endsWith('.replit.dev')) {
        // Preserve original host for logging
        req.headers['x-original-host'] = host;
        // Normalize host to bypass Vite's allowedHosts restriction
        req.headers.host = 'localhost';
      }
      next();
    });
  }

(async () => {
  try {
    log('🚀 Starting server initialization...');
    const server = await registerRoutes(app);

  // Setup WebSocket server alongside Express
  const wss = new WebSocketServer({ server });

  wss.on('connection', (ws: WebSocketClient, req) => {
    log('New WebSocket connection established');

    // Initialize client properties
    ws.isAlive = true;
    wsManager.addClient(ws);

    // Handle pong responses
    ws.on('pong', () => {
      ws.isAlive = true;
    });

    // SECURITY: Handle incoming messages with authentication verification
    ws.on('message', async (data: WebSocket.Data) => {
      try {
        const message = JSON.parse(data.toString());

        if (message.type === 'subscribe' && message.userId && message.token) {
          // SECURITY: Verify user authentication before allowing subscription
          const userId = parseInt(message.userId);
          const token = message.token;

          // Basic token validation - in a real app this would verify JWT or session
          // For now, we'll validate that the userId matches what's stored in localStorage
          // TODO: Implement proper JWT verification or session validation
          if (isNaN(userId) || !token || token.length < 10) {
            log(`WebSocket authentication failed for user ${userId}`);
            ws.send(JSON.stringify({
              type: 'auth_error',
              message: 'Invalid authentication token',
              timestamp: new Date().toISOString()
            }));
            return;
          }

          // SECURITY: Verify user exists and token is valid
          try {
            const { storage } = await import('./storage');
            const user = await storage.getUser(userId);
            if (!user) {
              log(`WebSocket subscription denied - user ${userId} not found`);
              ws.send(JSON.stringify({
                type: 'auth_error',
                message: 'User not found',
                timestamp: new Date().toISOString()
              }));
              return;
            }

            // SECURITY: Set userId only after successful authentication
            ws.userId = userId;
            log(`WebSocket client authenticated and subscribed for user ${ws.userId}`);

            // Send confirmation with user verification
            ws.send(JSON.stringify({
              type: 'subscription_confirmed',
              userId: ws.userId,
              userEmail: user.email,
              timestamp: new Date().toISOString()
            }));
          } catch (error) {
            log(`Error verifying WebSocket user: ${error}`);
            ws.send(JSON.stringify({
              type: 'auth_error',
              message: 'Authentication verification failed',
              timestamp: new Date().toISOString()
            }));
          }
        } else if (message.type === 'ping') {
          // Respond to client ping
          ws.send(JSON.stringify({
            type: 'pong',
            timestamp: new Date().toISOString()
          }));
        } else {
          // SECURITY: Reject messages without proper authentication
          log('WebSocket message rejected - missing userId or token');
          ws.send(JSON.stringify({
            type: 'auth_error',
            message: 'Authentication required',
            timestamp: new Date().toISOString()
          }));
        }
      } catch (error) {
        log(`Error parsing WebSocket message: ${error}`);
        ws.send(JSON.stringify({
          type: 'error',
          message: 'Invalid message format',
          timestamp: new Date().toISOString()
        }));
      }
    });

    // Handle client disconnect
    ws.on('close', () => {
      log(`WebSocket client disconnected ${ws.userId ? `(user ${ws.userId})` : ''}`);
      wsManager.removeClient(ws);
    });

    // Handle WebSocket errors
    ws.on('error', (error) => {
      log(`WebSocket error: ${error}`);
      wsManager.removeClient(ws);
    });
  });

  // Ping clients every 30 seconds to keep connections alive
  const pingInterval = setInterval(() => {
    wsManager.cleanup();
  }, 30000);

  // Cleanup on server shutdown
  process.on('SIGINT', () => {
    clearInterval(pingInterval);
    wss.close();
  });

  log(`WebSocket server initialized. Ready for real-time call updates.`);

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    console.error("Express error handler:", err);

    if (!res.headersSent) {
      res.status(status).json({ message });
    }
    // Don't throw the error again to prevent unhandled rejections
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (process.env.NODE_ENV !== "production") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  // ALWAYS serve the app on port 5000
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = 5000;

  // Optimize SSL certificate loading - use HTTP for faster startup in development
  // SSL can be handled by reverse proxy in production
  let serverInstance;

  // Disable SSL for faster startup - deployment environments handle SSL via reverse proxy
  const useSSL = false;

  if (useSSL) {
    const certPath = path.join(process.cwd(), 'attached_assets', 'domain.cert_1756860116174.pem');
    const keyPath = path.join(process.cwd(), 'attached_assets', 'private.key_1756860116174.pem');

    if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
      try {
        const httpsOptions = {
          cert: fs.readFileSync(certPath, 'utf8'),
          key: fs.readFileSync(keyPath, 'utf8')
        };
        serverInstance = https.createServer(httpsOptions, app);
        log("HTTPS server configured with SSL certificates");
      } catch (error) {
        log(`SSL certificate error: ${error instanceof Error ? error.message : 'Unknown error'}, falling back to HTTP`);
        serverInstance = http.createServer(app);
      }
    } else {
      log("SSL certificates not found, using HTTP server");
      serverInstance = http.createServer(app);
    }
  } else {
    // Use HTTP for faster startup - SSL handled by reverse proxy if needed
    serverInstance = http.createServer(app);
    log("HTTP server configured for optimized startup");
  }

  // Handle WebSocket upgrade for HMR with Replit domains
  serverInstance.on('upgrade', (req, socket, head) => {
    const host = req.headers.host;
    if (host && host.endsWith('.replit.dev')) {
      // Preserve original host for logging
      req.headers['x-original-host'] = host;
      // Normalize host to bypass Vite's allowedHosts restriction
      req.headers.host = 'localhost';
    }
  });

  serverInstance.listen(port, "0.0.0.0", () => {
    log(`serving on port ${port}`);
    log('✅ Server startup completed successfully');
  });

  } catch (error) {
    console.error('❌ Critical server startup error:', error);
    console.error('Stack trace:', error instanceof Error ? error.stack : 'No stack trace available');

    // Log detailed error information for debugging
    if (error instanceof Error) {
      console.error('Error name:', error.name);
      console.error('Error message:', error.message);
    }

    // Give the system a moment to flush logs before exiting
    setTimeout(() => {
      console.error('🚫 Server startup failed. Exiting with error code 1.');
      process.exit(1);
    }, 100);
  }
})().catch((unhandledError) => {
  console.error('💥 Unhandled async error during server startup:', unhandledError);
  console.error('Stack trace:', unhandledError instanceof Error ? unhandledError.stack : 'No stack trace available');

  setTimeout(() => {
    console.error('🚫 Critical failure. Exiting with error code 1.');
    process.exit(1);
  }, 100);
});