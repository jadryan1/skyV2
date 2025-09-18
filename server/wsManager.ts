import WebSocket from "ws";

// WebSocket client management
interface WebSocketClient extends WebSocket {
  userId?: number;
  isAlive: boolean;
}

class WebSocketManager {
  private clients: Set<WebSocketClient> = new Set();
  
  addClient(client: WebSocketClient) {
    this.clients.add(client);
    console.log(`WebSocket client connected. Total clients: ${this.clients.size}`);
  }
  
  removeClient(client: WebSocketClient) {
    this.clients.delete(client);
    console.log(`WebSocket client disconnected. Total clients: ${this.clients.size}`);
  }
  
  broadcastToUser(userId: number, data: any) {
    const userClients = Array.from(this.clients).filter(client => 
      client.userId === userId && client.readyState === WebSocket.OPEN
    );
    
    userClients.forEach(client => {
      try {
        client.send(JSON.stringify(data));
      } catch (error) {
        console.error('Error sending message to client:', error);
        this.removeClient(client);
      }
    });
    
    return userClients.length;
  }
  
  broadcast(data: any) {
    this.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        try {
          client.send(JSON.stringify(data));
        } catch (error) {
          console.error('Error broadcasting message:', error);
          this.removeClient(client);
        }
      }
    });
  }
  
  cleanup() {
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
export const wsManager = new WebSocketManager();
export type { WebSocketClient };