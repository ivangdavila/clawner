// Clawner Agent - Runs on hosts and connects to ClawDay orchestrator
import WebSocket from 'ws';
import { EventEmitter } from 'events';
import * as os from 'os';
import * as commands from './commands.js';

export interface AgentConfig {
  serverUrl: string;
  inviteCode?: string;
  hostId?: string;
  name?: string;
  heartbeatInterval?: number;
  reconnect?: boolean;
  onConnected?: (hostId: string) => void;
  onDisconnected?: (code: number, reason: string) => void;
  onCommand?: (command: RemoteCommand, result: commands.CommandResult) => void;
  onError?: (error: Error) => void;
}

export interface RemoteCommand {
  id?: string;
  type: string;
  payload?: Record<string, unknown>;
}

export class ClawnerAgent extends EventEmitter {
  private config: AgentConfig;
  private ws: WebSocket | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private connected = false;
  private hostId: string | null = null;

  constructor(config: AgentConfig) {
    super();
    this.config = {
      heartbeatInterval: 30000,
      name: os.hostname(),
      reconnect: true,
      ...config,
    };
  }

  get isConnected(): boolean {
    return this.connected;
  }

  get currentHostId(): string | null {
    return this.hostId;
  }

  async connect(): Promise<string> {
    return new Promise((resolve, reject) => {
      if (this.ws && this.connected) {
        resolve(this.hostId!);
        return;
      }

      console.log(`[Clawner] Connecting to ${this.config.serverUrl}...`);
      
      try {
        this.ws = new WebSocket(this.config.serverUrl);
      } catch (err) {
        reject(err);
        return;
      }

      const connectionTimeout = setTimeout(() => {
        if (!this.connected) {
          this.ws?.close();
          reject(new Error('Connection timeout'));
        }
      }, 30000);

      this.ws.on('open', () => {
        console.log('[Clawner] WebSocket connected, authenticating...');
        this.sendJoin();
      });

      this.ws.on('message', (data) => {
        try {
          const message = JSON.parse(data.toString());
          this.handleMessage(message, resolve, reject, connectionTimeout);
        } catch (err) {
          console.error('[Clawner] Error parsing message:', err);
        }
      });

      this.ws.on('close', (code, reason) => {
        clearTimeout(connectionTimeout);
        const reasonStr = reason.toString() || 'unknown';
        console.log(`[Clawner] Disconnected: ${code} ${reasonStr}`);
        
        this.connected = false;
        this.stopHeartbeat();
        
        this.emit('disconnected', code, reasonStr);
        this.config.onDisconnected?.(code, reasonStr);
        
        // Auto-reconnect unless explicitly closed or invalid invite
        if (this.config.reconnect && this.hostId && code !== 4001 && code !== 1000) {
          this.scheduleReconnect();
        }
      });

      this.ws.on('error', (err) => {
        console.error('[Clawner] WebSocket error:', err.message);
        this.emit('error', err);
        this.config.onError?.(err);
        
        if (!this.connected) {
          clearTimeout(connectionTimeout);
          reject(err);
        }
      });
    });
  }

  disconnect(): void {
    this.config.reconnect = false;
    
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    
    this.stopHeartbeat();
    
    if (this.ws) {
      this.ws.close(1000, 'Agent shutting down');
      this.ws = null;
    }
    
    this.connected = false;
    console.log('[Clawner] Disconnected');
  }

  // Send a message to the server
  send(type: string, payload: Record<string, unknown> = {}): void {
    if (this.ws && this.connected) {
      this.ws.send(JSON.stringify({ type, payload }));
    }
  }

  private sendJoin(): void {
    const status = commands.getFullStatus();
    
    const joinMessage = {
      type: 'join',
      payload: {
        inviteCode: this.config.inviteCode,
        hostId: this.config.hostId,
        name: this.config.name,
        hostname: os.hostname(),
        openclawVersion: status.success ? (status.data as any).openclawVersion : 'unknown',
        openclawInstalled: status.success ? (status.data as any).openclawInstalled : false,
        osInfo: {
          platform: os.platform(),
          release: os.release(),
          arch: os.arch(),
        },
        capabilities: this.getCapabilities(),
      },
    };
    
    this.ws?.send(JSON.stringify(joinMessage));
  }

  private getCapabilities(): string[] {
    const caps: string[] = ['heartbeat', 'status'];
    
    const version = commands.getVersion();
    if (version.success) {
      caps.push(
        'gateway_control',
        'agent_management',
        'config',
        'logs',
        'message',
        'update'
      );
    }
    
    return caps;
  }

  private handleMessage(
    message: Record<string, unknown>,
    resolve?: (value: string) => void,
    reject?: (reason?: unknown) => void,
    connectionTimeout?: NodeJS.Timeout
  ): void {
    switch (message.type) {
      case 'joined':
        if (connectionTimeout) clearTimeout(connectionTimeout);
        this.hostId = message.hostId as string;
        this.connected = true;
        this.reconnectAttempts = 0;
        
        console.log(`[Clawner] ✅ Joined as: ${this.hostId}`);
        
        this.startHeartbeat();
        this.emit('connected', this.hostId);
        this.config.onConnected?.(this.hostId);
        resolve?.(this.hostId);
        break;

      case 'error':
        const errorMsg = message.message as string || 'Unknown error';
        console.error(`[Clawner] ❌ Error: ${errorMsg}`);
        
        if (!this.connected) {
          if (connectionTimeout) clearTimeout(connectionTimeout);
          reject?.(new Error(errorMsg));
        }
        break;

      case 'command':
        console.log('[Clawner] 📨 Received command message:', JSON.stringify(message));
        this.handleCommand(message as unknown as { type: string; command: RemoteCommand });
        break;

      case 'ping':
        this.send('pong', { timestamp: Date.now() });
        break;

      case 'welcome':
        console.log(`[Clawner] Server: ${message.message}`);
        break;

      default:
        console.log(`[Clawner] Unknown message: ${message.type}`);
        this.emit('message', message);
    }
  }

  private handleCommand(message: { type: string; command: RemoteCommand }): void {
    const cmd = message.command || message as unknown as RemoteCommand;
    const cmdType = cmd.type;
    const cmdId = cmd.id;
    const payload = cmd.payload || {};

    console.log(`[Clawner] 📥 Command: ${cmdType}`);
    
    let result: commands.CommandResult;

    try {
      switch (cmdType) {
        case 'get_status':
        case 'status':
          result = commands.getFullStatus();
          break;

        case 'get_version':
        case 'version':
          result = commands.getVersion();
          break;

        case 'get_gateway_status':
        case 'gateway_status':
          result = commands.getGatewayStatus();
          break;

        case 'get_health':
        case 'health':
          result = commands.getHealth();
          break;

        case 'start_gateway':
          result = commands.startGateway(payload as any);
          break;

        case 'stop_gateway':
          result = commands.stopGateway();
          break;

        case 'restart_gateway':
          result = commands.restartGateway();
          break;

        case 'list_agents':
        case 'agents':
          result = commands.listAgents();
          break;

        case 'add_agent':
        case 'create_agent':
          result = commands.addAgent(
            payload.name as string,
            { 
              model: payload.model as string,
              workspace: payload.workspace as string 
            }
          );
          break;

        case 'delete_agent':
        case 'remove_agent':
          result = commands.deleteAgent(payload.name as string);
          break;

        case 'send_message':
        case 'message':
          result = commands.sendMessage({
            target: payload.target as string,
            message: payload.message as string,
            channel: payload.channel as string,
            replyTo: payload.replyTo as string,
          });
          break;

        case 'get_logs':
        case 'logs':
          result = commands.getLogs({
            lines: payload.lines as number,
          });
          break;

        case 'get_config':
        case 'config':
          result = commands.getConfig(payload.key as string);
          break;

        case 'set_config':
          result = commands.setConfig(
            payload.key as string,
            payload.value as string
          );
          break;

        case 'update_openclaw':
        case 'update':
          result = commands.updateOpenClaw();
          break;

        case 'doctor':
          result = commands.runDoctor();
          break;

        default:
          result = { success: false, error: `Unknown command: ${cmdType}` };
      }
    } catch (err: any) {
      result = { success: false, error: err.message || String(err) };
    }

    // Send response
    this.send('command_result', {
      commandId: cmdId,
      commandType: cmdType,
      ...result,
    });

    this.emit('command', cmd, result);
    this.config.onCommand?.(cmd, result);
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    
    // Send initial heartbeat
    this.sendHeartbeat();
    
    this.heartbeatTimer = setInterval(() => {
      this.sendHeartbeat();
    }, this.config.heartbeatInterval);
  }

  private sendHeartbeat(): void {
    if (!this.ws || !this.connected) return;

    const status = commands.getFullStatus();
    
    const statusData = status.success && typeof status.data === 'object' ? status.data : {};
    
    const heartbeat = {
      type: 'heartbeat',
      payload: {
        timestamp: new Date().toISOString(),
        hostId: this.hostId,
        ...statusData,
      },
    };
    
    this.ws.send(JSON.stringify(heartbeat));
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.log('[Clawner] Max reconnect attempts reached, giving up');
      return;
    }

    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 60000);
    this.reconnectAttempts++;
    
    console.log(`[Clawner] Reconnecting in ${delay/1000}s (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})...`);
    
    this.reconnectTimer = setTimeout(() => {
      console.log('[Clawner] Attempting to reconnect...');
      this.connect().catch((err) => {
        console.error('[Clawner] Reconnect failed:', err.message);
      });
    }, delay);
  }
}

// Factory functions
export function createAgent(config: AgentConfig): ClawnerAgent {
  return new ClawnerAgent(config);
}

export { commands };
export default ClawnerAgent;
