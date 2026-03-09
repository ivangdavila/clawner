// Clawner - AI Company Orchestrator
// Server component that manages connections to hosts running OpenClaw agents

import { WebSocketServer, WebSocket } from 'ws';
import { createServer, IncomingMessage, ServerResponse } from 'http';
import { EventEmitter } from 'events';
import { parse as parseUrl } from 'url';

export interface ClawnerConfig {
  port: number;
  onHostConnect?: (host: HostConnection) => void;
  onHostDisconnect?: (hostId: string) => void;
  onHostMessage?: (hostId: string, message: HostMessage) => void;
  onHostHeartbeat?: (hostId: string, data: HeartbeatData) => void;
}

export interface HostConnection {
  id: string;
  name: string;
  hostname?: string;
  ipAddress?: string;
  status: 'pending' | 'connected' | 'disconnected';
  openclawVersion?: string;
  openclawInstalled?: boolean;
  capabilities?: string[];
  osInfo?: {
    platform: string;
    release: string;
    arch: string;
  };
  systemInfo?: SystemInfo;
  lastSeen: Date;
  connectedAt?: Date;
  ws?: WebSocket;
}

export interface SystemInfo {
  hostname: string;
  platform: string;
  arch: string;
  uptime: number;
  loadAvg: number[];
  freeMemory: number;
  totalMemory: number;
  cpuCount: number;
}

export interface HostMessage {
  type: string;
  payload: Record<string, unknown>;
}

export interface HeartbeatData {
  timestamp: string;
  system: SystemInfo;
  openclawVersion?: string;
  gateway?: {
    running: boolean;
    pid?: number;
  };
  agents?: Array<{
    id: string;
    name: string;
    status: string;
  }>;
}

export interface CommandRequest {
  type: string;
  payload?: Record<string, unknown>;
}

export interface CommandResponse {
  commandId: string;
  commandType: string;
  success: boolean;
  data?: unknown;
  error?: string;
}

export class Clawner extends EventEmitter {
  private config: ClawnerConfig;
  private httpServer: ReturnType<typeof createServer>;
  private wss: WebSocketServer;
  private hosts: Map<string, HostConnection> = new Map();
  private inviteCodes: Map<string, { hostId: string; expiresAt: Date }> = new Map();
  private pendingCommands: Map<string, { 
    resolve: (result: CommandResponse) => void;
    reject: (error: Error) => void;
    timeout: NodeJS.Timeout;
  }> = new Map();
  private commandIdCounter = 0;

  constructor(config: ClawnerConfig) {
    super();
    this.config = config;

    // Create HTTP server for REST API
    this.httpServer = createServer((req, res) => this.handleHttp(req, res));

    // Create WebSocket server
    this.wss = new WebSocketServer({ server: this.httpServer });
    this.wss.on('connection', (ws, req) => this.handleConnection(ws, req));
  }

  start(): Promise<void> {
    return new Promise((resolve) => {
      this.httpServer.listen(this.config.port, () => {
        console.log(`[Clawner] Server running on port ${this.config.port}`);
        console.log(`[Clawner] WebSocket ready for host connections`);
        console.log(`[Clawner] REST API: http://localhost:${this.config.port}`);
        resolve();
      });
    });
  }

  stop(): Promise<void> {
    return new Promise((resolve) => {
      // Reject all pending commands
      for (const [id, pending] of this.pendingCommands) {
        clearTimeout(pending.timeout);
        pending.reject(new Error('Server shutting down'));
        this.pendingCommands.delete(id);
      }

      // Close all host connections
      for (const [, host] of this.hosts) {
        if (host.ws) {
          host.ws.close(1000, 'Server shutting down');
        }
      }
      
      this.wss.close();
      this.httpServer.close(() => {
        console.log('[Clawner] Server stopped');
        resolve();
      });
    });
  }

  // Generate invite code for new host
  generateInviteCode(hostId: string, expiresInMs: number = 24 * 60 * 60 * 1000): string {
    const code = this.randomCode(8);
    this.inviteCodes.set(code, {
      hostId,
      expiresAt: new Date(Date.now() + expiresInMs),
    });
    return code;
  }

  // Validate and consume invite code
  validateInviteCode(code: string): string | null {
    const invite = this.inviteCodes.get(code);
    if (!invite) return null;
    if (invite.expiresAt < new Date()) {
      this.inviteCodes.delete(code);
      return null;
    }
    return invite.hostId;
  }

  // Get all hosts
  getHosts(): HostConnection[] {
    return Array.from(this.hosts.values()).map(h => ({
      ...h,
      ws: undefined, // Don't expose WebSocket
    }));
  }

  // Get a specific host
  getHost(hostId: string): HostConnection | null {
    const host = this.hosts.get(hostId);
    if (!host) return null;
    return { ...host, ws: undefined };
  }

  // Check if host is connected
  isHostConnected(hostId: string): boolean {
    const host = this.hosts.get(hostId);
    return host?.status === 'connected' && host?.ws?.readyState === WebSocket.OPEN;
  }

  // Send command to host and wait for response
  async sendCommand(hostId: string, command: CommandRequest, timeoutMs = 30000): Promise<CommandResponse> {
    const host = this.hosts.get(hostId);
    if (!host || !host.ws || host.ws.readyState !== WebSocket.OPEN) {
      throw new Error(`Host ${hostId} not connected`);
    }

    const commandId = `cmd_${++this.commandIdCounter}_${Date.now()}`;
    
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingCommands.delete(commandId);
        reject(new Error(`Command ${command.type} timed out`));
      }, timeoutMs);

      this.pendingCommands.set(commandId, { resolve, reject, timeout });

      host.ws!.send(JSON.stringify({
        type: 'command',
        command: {
          id: commandId,
          type: command.type,
          payload: command.payload || {},
        },
      }));
    });
  }

  // Fire and forget command (no response expected)
  sendToHost(hostId: string, message: Record<string, unknown>): boolean {
    const host = this.hosts.get(hostId);
    if (!host || !host.ws || host.ws.readyState !== WebSocket.OPEN) {
      return false;
    }
    host.ws.send(JSON.stringify(message));
    return true;
  }

  // Broadcast to all connected hosts
  broadcast(message: Record<string, unknown>): number {
    const payload = JSON.stringify(message);
    let count = 0;
    for (const [, host] of this.hosts) {
      if (host.ws && host.ws.readyState === WebSocket.OPEN) {
        host.ws.send(payload);
        count++;
      }
    }
    return count;
  }

  private handleHttp(req: IncomingMessage, res: ServerResponse): void {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    res.setHeader('Content-Type', 'application/json');

    const url = parseUrl(req.url || '/', true);
    const path = url.pathname || '/';

    // Health check
    if (req.method === 'GET' && path === '/health') {
      res.writeHead(200);
      res.end(JSON.stringify({ 
        status: 'ok', 
        hosts: this.hosts.size,
        connectedHosts: Array.from(this.hosts.values()).filter(h => h.status === 'connected').length,
      }));
      return;
    }

    // List hosts
    if (req.method === 'GET' && path === '/hosts') {
      res.writeHead(200);
      res.end(JSON.stringify(this.getHosts()));
      return;
    }

    // Get specific host
    const hostMatch = path.match(/^\/hosts\/([^/]+)$/);
    if (req.method === 'GET' && hostMatch) {
      const host = this.getHost(hostMatch[1]);
      if (host) {
        res.writeHead(200);
        res.end(JSON.stringify(host));
      } else {
        res.writeHead(404);
        res.end(JSON.stringify({ error: 'Host not found' }));
      }
      return;
    }

    // Send command to host
    const cmdMatch = path.match(/^\/hosts\/([^/]+)\/command$/);
    if (req.method === 'POST' && cmdMatch) {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', async () => {
        try {
          const command = JSON.parse(body) as CommandRequest;
          const result = await this.sendCommand(cmdMatch[1], command);
          res.writeHead(200);
          res.end(JSON.stringify(result));
        } catch (err: any) {
          res.writeHead(err.message.includes('not connected') ? 404 : 500);
          res.end(JSON.stringify({ error: err.message }));
        }
      });
      return;
    }

    // Generate invite code
    if (req.method === 'POST' && path === '/invite') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => {
        try {
          const { hostId, expiresInMs } = JSON.parse(body || '{}');
          const id = hostId || `host_${Date.now()}`;
          const code = this.generateInviteCode(id, expiresInMs);
          res.writeHead(200);
          res.end(JSON.stringify({ 
            code, 
            hostId: id,
            expiresAt: new Date(Date.now() + (expiresInMs || 24 * 60 * 60 * 1000)).toISOString(),
          }));
        } catch (err: any) {
          res.writeHead(400);
          res.end(JSON.stringify({ error: err.message }));
        }
      });
      return;
    }

    res.writeHead(404);
    res.end(JSON.stringify({ error: 'Not found' }));
  }

  private handleConnection(ws: WebSocket, req: IncomingMessage): void {
    const ip = req.socket.remoteAddress;
    console.log(`[Clawner] New connection from ${ip}`);

    let hostId: string | null = null;

    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString()) as HostMessage;
        
        if (message.type === 'join') {
          this.handleJoin(ws, message.payload, ip || 'unknown');
          hostId = message.payload.inviteCode 
            ? this.validateInviteCode(message.payload.inviteCode as string)
            : message.payload.hostId as string;
        } else if (message.type === 'heartbeat' && hostId) {
          this.handleHeartbeat(hostId, message.payload);
        } else if (message.type === 'command_result') {
          this.handleCommandResult(message.payload as unknown as CommandResponse);
        } else if (message.type === 'pong') {
          // Heartbeat response, update lastSeen
          const host = this.hosts.get(hostId!);
          if (host) host.lastSeen = new Date();
        } else if (hostId) {
          this.emit('host:message', hostId, message);
          this.config.onHostMessage?.(hostId, message);
        }
      } catch (err) {
        console.error('[Clawner] Error parsing message:', err);
      }
    });

    ws.on('close', () => {
      if (hostId) {
        const host = this.hosts.get(hostId);
        if (host) {
          host.status = 'disconnected';
          host.ws = undefined;
          console.log(`[Clawner] Host disconnected: ${host.name} (${hostId})`);
          this.emit('host:disconnect', hostId);
          this.config.onHostDisconnect?.(hostId);
        }
      }
    });

    ws.on('error', (err) => {
      console.error(`[Clawner] WebSocket error:`, err);
    });

    // Send welcome
    ws.send(JSON.stringify({ type: 'welcome', message: 'Clawner server ready' }));
  }

  private handleJoin(ws: WebSocket, payload: Record<string, unknown>, ip: string): void {
    const { inviteCode, hostId: providedHostId, name, hostname, openclawVersion, openclawInstalled, osInfo, capabilities } = payload;

    // Validate invite code or host ID
    let hostId: string | null = null;
    
    if (inviteCode) {
      hostId = this.validateInviteCode(inviteCode as string);
      if (!hostId) {
        ws.send(JSON.stringify({ type: 'error', message: 'Invalid or expired invite code' }));
        ws.close(4001, 'Invalid invite code');
        return;
      }
      this.inviteCodes.delete(inviteCode as string);
    } else if (providedHostId) {
      // Allow reconnect with existing host ID
      hostId = providedHostId as string;
    } else {
      ws.send(JSON.stringify({ type: 'error', message: 'Invite code or host ID required' }));
      ws.close(4002, 'Missing credentials');
      return;
    }

    // Register/update host
    const host: HostConnection = {
      id: hostId,
      name: (name as string) || hostname as string || hostId,
      hostname: hostname as string,
      ipAddress: ip,
      openclawVersion: openclawVersion as string,
      openclawInstalled: openclawInstalled as boolean,
      osInfo: osInfo as HostConnection['osInfo'],
      capabilities: capabilities as string[],
      status: 'connected',
      lastSeen: new Date(),
      connectedAt: new Date(),
      ws,
    };
    
    this.hosts.set(hostId, host);

    ws.send(JSON.stringify({ type: 'joined', hostId }));
    console.log(`[Clawner] Host joined: ${host.name} (${hostId})`);
    
    this.emit('host:connect', { ...host, ws: undefined });
    this.config.onHostConnect?.({ ...host, ws: undefined });
  }

  private handleHeartbeat(hostId: string, payload: Record<string, unknown>): void {
    const host = this.hosts.get(hostId);
    if (!host) return;

    host.lastSeen = new Date();
    host.status = 'connected';

    // Update host info from heartbeat
    if (payload.system) {
      host.systemInfo = payload.system as SystemInfo;
    }
    if (payload.openclawVersion) {
      host.openclawVersion = payload.openclawVersion as string;
    }

    const heartbeatData: HeartbeatData = {
      timestamp: payload.timestamp as string || new Date().toISOString(),
      system: payload.system as SystemInfo,
      openclawVersion: payload.openclawVersion as string,
      gateway: payload.gateway as HeartbeatData['gateway'],
      agents: payload.agents as HeartbeatData['agents'],
    };

    this.emit('host:heartbeat', hostId, heartbeatData);
    this.config.onHostHeartbeat?.(hostId, heartbeatData);
  }

  private handleCommandResult(result: CommandResponse): void {
    const pending = this.pendingCommands.get(result.commandId);
    if (pending) {
      clearTimeout(pending.timeout);
      this.pendingCommands.delete(result.commandId);
      pending.resolve(result);
    }
  }

  private randomCode(length: number): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }
}

// Factory function
export function createClawner(config: ClawnerConfig): Clawner {
  return new Clawner(config);
}

export default Clawner;
