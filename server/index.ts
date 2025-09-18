import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
import path from "path";
import fs from "fs";
import https from "https";
import http from "http";
import WebSocket, { WebSocketServer } from "ws";

// SSL certificate has been updated - normal TLS validation restored

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

// WebSocket client management
interface WebSocketClient extends WebSocket {
  userId?: number;
  isAlive: boolean;
}

class WebSocketManager {
  private clients: Set<WebSocketClient> = new Set();
  
  addClient(client: WebSocketClient) {
    this.clients.add(client);
    log(`WebSocket client connected. Total clients: ${this.clients.size}`);
  }
  
  removeClient(client: WebSocketClient) {
    this.clients.delete(client);
    log(`WebSocket client disconnected. Total clients: ${this.clients.size}`);
  }
  
  broadcastToUser(userId: number, data: any) {
    const userClients = Array.from(this.clients).filter(client => 
      client.userId === userId && client.readyState === WebSocket.OPEN
    );
    
    const message = JSON.stringify(data);
    let sentCount = 0;
    
    userClients.forEach(client => {
      try {
        client.send(message);
        sentCount++;
      } catch (error) {
        log(`Error sending WebSocket message to user ${userId}: ${error}`);
        this.removeClient(client);
      }
    });
    
    log(`Broadcasted call update to ${sentCount} clients for user ${userId}`);
    return sentCount;
  }
  
  pingClients() {
    const deadClients: WebSocketClient[] = [];
    
    this.clients.forEach(client => {
      if (!client.isAlive) {
        deadClients.push(client);
        return;
      }
      
      client.isAlive = false;
      client.ping();
    });
    
    // Remove dead clients
    deadClients.forEach(client => {
      this.removeClient(client);
      client.terminate();
    });
  }
  
  getClientCount(): number {
    return this.clients.size;
  }
  
  getUserClientCount(userId: number): number {
    return Array.from(this.clients).filter(client => client.userId === userId).length;
  }
}

// Global WebSocket manager instance
const wsManager = new WebSocketManager();

// Export for use in routes
export { wsManager };

// Raw body capture middleware for webhook signature verification
// This must be before express.json() to capture the raw bytes

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

  // Middleware to handle Replit host restrictions
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

(async () => {
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
    
    // Handle incoming messages
    ws.on('message', (data: WebSocket.Data) => {
      try {
        const message = JSON.parse(data.toString());
        
        if (message.type === 'subscribe' && message.userId) {
          ws.userId = parseInt(message.userId);
          log(`WebSocket client subscribed to updates for user ${ws.userId}`);
          
          // Send confirmation
          ws.send(JSON.stringify({
            type: 'subscription_confirmed',
            userId: ws.userId,
            timestamp: new Date().toISOString()
          }));
        } else if (message.type === 'ping') {
          // Respond to client ping
          ws.send(JSON.stringify({
            type: 'pong',
            timestamp: new Date().toISOString()
          }));
        }
      } catch (error) {
        log(`Error parsing WebSocket message: ${error}`);
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
    wsManager.pingClients();
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
  if (app.get("env") === "development") {
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
  });
})();