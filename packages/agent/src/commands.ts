// OpenClaw command handlers for clawner
import { execSync, spawn, ChildProcess } from 'child_process';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';

export interface CommandResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

export interface AgentInfo {
  id: string;
  name: string;
  emoji?: string;
  bindings?: string[];
}

export interface GatewayStatus {
  running: boolean;
  pid?: number;
  port?: number;
  uptime?: number;
  sessions?: number;
  version?: string;
}

export interface SystemInfo {
  hostname: string;
  platform: string;
  arch: string;
  release: string;
  uptime: number;
  loadAvg: number[];
  freeMemory: number;
  totalMemory: number;
  cpuCount: number;
}

// Find openclaw binary
function findOpenClaw(): string {
  const paths = [
    process.env.OPENCLAW_PATH,
    '/usr/local/bin/openclaw',
    '/opt/homebrew/bin/openclaw',
    `${os.homedir()}/local/bin/openclaw`,
    `${os.homedir()}/.npm-global/bin/openclaw`,
  ].filter(Boolean) as string[];

  for (const p of paths) {
    if (fs.existsSync(p)) return p;
  }

  // Try which
  try {
    return execSync('which openclaw 2>/dev/null', { encoding: 'utf-8' }).trim();
  } catch {
    return 'openclaw'; // Hope it's in PATH
  }
}

const OPENCLAW = findOpenClaw();

function exec(cmd: string, timeout = 30000): string {
  try {
    return execSync(cmd, { 
      encoding: 'utf-8', 
      timeout,
      env: { ...process.env, PATH: `${os.homedir()}/local/bin:${process.env.PATH}` }
    }).trim();
  } catch (err: any) {
    throw new Error(err.stderr || err.message || String(err));
  }
}

// Get OpenClaw version
export function getVersion(): CommandResult {
  try {
    const version = exec(`${OPENCLAW} --version 2>/dev/null`);
    return { success: true, data: { version } };
  } catch {
    return { success: false, error: 'OpenClaw not installed or not in PATH' };
  }
}

// Get system information
export function getSystemInfo(): SystemInfo {
  return {
    hostname: os.hostname(),
    platform: os.platform(),
    arch: os.arch(),
    release: os.release(),
    uptime: os.uptime(),
    loadAvg: os.loadavg(),
    freeMemory: os.freemem(),
    totalMemory: os.totalmem(),
    cpuCount: os.cpus().length,
  };
}

// Get gateway status
export function getGatewayStatus(): CommandResult {
  try {
    const output = exec(`${OPENCLAW} gateway status --json 2>/dev/null || ${OPENCLAW} gateway status 2>&1`);
    
    // Try to parse as JSON first
    try {
      const data = JSON.parse(output);
      return { success: true, data };
    } catch {
      // Parse text output
      const running = output.includes('running') || output.includes('online');
      return { 
        success: true, 
        data: { 
          running,
          raw: output 
        } 
      };
    }
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

// Get health from running gateway
export function getHealth(): CommandResult {
  try {
    const output = exec(`${OPENCLAW} health --json 2>/dev/null || ${OPENCLAW} health 2>&1`);
    try {
      return { success: true, data: JSON.parse(output) };
    } catch {
      return { success: true, data: { raw: output } };
    }
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

// List configured agents
export function listAgents(): CommandResult {
  try {
    const output = exec(`${OPENCLAW} agents list --json 2>/dev/null || ${OPENCLAW} agents list 2>&1`);
    try {
      return { success: true, data: JSON.parse(output) };
    } catch {
      // Parse text output
      const agents: AgentInfo[] = [];
      const lines = output.split('\n').filter(l => l.trim());
      for (const line of lines) {
        // Parse lines like: "  agent-name (emoji) -> binding1, binding2"
        const match = line.match(/^\s*(\S+)\s*(?:\(([^)]*)\))?\s*(?:->\s*(.*))?$/);
        if (match) {
          agents.push({
            id: match[1],
            name: match[1],
            emoji: match[2],
            bindings: match[3]?.split(',').map(b => b.trim()).filter(Boolean),
          });
        }
      }
      return { success: true, data: { agents } };
    }
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

// Start gateway
export function startGateway(options?: { port?: number; background?: boolean }): CommandResult {
  try {
    const portArg = options?.port ? `--port ${options.port}` : '';
    
    if (options?.background) {
      // Use service start
      exec(`${OPENCLAW} gateway start ${portArg}`);
      return { success: true, data: { message: 'Gateway service started' } };
    } else {
      // Spawn in foreground (caller handles the process)
      const args = ['gateway', 'run'];
      if (options?.port) args.push('--port', String(options.port));
      
      const child = spawn(OPENCLAW, args, {
        detached: true,
        stdio: 'ignore',
        env: { ...process.env, PATH: `${os.homedir()}/local/bin:${process.env.PATH}` }
      });
      child.unref();
      
      return { success: true, data: { message: 'Gateway started', pid: child.pid } };
    }
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

// Stop gateway
export function stopGateway(): CommandResult {
  try {
    exec(`${OPENCLAW} gateway stop`);
    return { success: true, data: { message: 'Gateway stopped' } };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

// Restart gateway
export function restartGateway(): CommandResult {
  try {
    exec(`${OPENCLAW} gateway restart`);
    return { success: true, data: { message: 'Gateway restarted' } };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

// Add a new agent
export function addAgent(name: string, options?: { model?: string; workspace?: string }): CommandResult {
  try {
    // Generate default workspace if not provided
    const workspace = options?.workspace || `${os.homedir()}/.openclaw/workspaces/${name}`;
    
    let cmd = `${OPENCLAW} agents add "${name}" --non-interactive --workspace "${workspace}"`;
    if (options?.model) cmd += ` --model "${options.model}"`;
    
    const output = exec(cmd, 60000);
    return { success: true, data: { message: output || `Agent ${name} created`, workspace } };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

// Delete an agent
export function deleteAgent(name: string): CommandResult {
  try {
    exec(`${OPENCLAW} agents delete "${name}" --force`);
    return { success: true, data: { message: `Agent ${name} deleted` } };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

// Send message to a channel/target
export function sendMessage(options: { 
  target: string; 
  message: string; 
  channel?: string;
  replyTo?: string;
}): CommandResult {
  try {
    let cmd = `${OPENCLAW} message send -t "${options.target}" -m "${options.message.replace(/"/g, '\\"')}"`;
    if (options.channel) cmd += ` --channel "${options.channel}"`;
    if (options.replyTo) cmd += ` --reply-to "${options.replyTo}"`;
    
    const output = exec(cmd, 60000);
    return { success: true, data: { message: output || 'Message sent' } };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

// Get logs
export function getLogs(options?: { lines?: number; limit?: number; follow?: boolean }): CommandResult {
  try {
    let cmd = `${OPENCLAW} logs --plain`;
    const limitVal = options?.limit || options?.lines || 50;
    cmd += ` --limit ${limitVal}`;
    // Note: follow mode not supported via exec
    
    const output = exec(cmd, 15000);
    return { success: true, data: { logs: output } };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

// Get config value
export function getConfig(key?: string): CommandResult {
  try {
    if (!key) {
      // Read config file directly (standard OpenClaw path)
      const configPath = path.join(os.homedir(), '.openclaw', 'openclaw.json');
      if (!fs.existsSync(configPath)) {
        return { success: false, error: 'Config file not found' };
      }
      const configContent = fs.readFileSync(configPath, 'utf-8');
      try {
        return { success: true, data: JSON.parse(configContent) };
      } catch {
        return { success: true, data: { raw: configContent } };
      }
    }
    
    const output = exec(`${OPENCLAW} config get "${key}"`);
    try {
      return { success: true, data: JSON.parse(output) };
    } catch {
      return { success: true, data: { value: output.trim() } };
    }
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

// Set config value
export function setConfig(key: string, value: string): CommandResult {
  try {
    exec(`${OPENCLAW} config set "${key}" "${value}"`);
    return { success: true, data: { message: `Config ${key} updated` } };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

// Update OpenClaw
export function updateOpenClaw(): CommandResult {
  try {
    const output = exec('npm update -g openclaw 2>&1', 120000);
    const newVersion = getVersion();
    return { 
      success: true, 
      data: { 
        message: output || 'Update complete',
        version: newVersion.success ? (newVersion.data as any).version : 'unknown'
      } 
    };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

// Run doctor checks
export function runDoctor(): CommandResult {
  try {
    const output = exec(`${OPENCLAW} doctor 2>&1`, 60000);
    return { success: true, data: { report: output } };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

// Get full status (combines multiple checks)
export function getFullStatus(): CommandResult {
  const version = getVersion();
  const gateway = getGatewayStatus();
  const agents = listAgents();
  const system = getSystemInfo();
  
  return {
    success: true,
    data: {
      openclawVersion: version.success ? (version.data as any).version : 'not installed',
      openclawInstalled: version.success,
      gateway: gateway.success ? gateway.data : null,
      agents: agents.success ? agents.data : null,
      system,
    }
  };
}
