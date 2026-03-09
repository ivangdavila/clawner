#!/usr/bin/env node
// Clawner Agent CLI - Connect your host to ClawDay

import { Command } from 'commander';
import { ClawnerAgent } from './index.js';
import * as commands from './commands.js';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';

const CONFIG_DIR = path.join(os.homedir(), '.clawner');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');
const PID_FILE = path.join(CONFIG_DIR, 'agent.pid');
const LOG_FILE = path.join(CONFIG_DIR, 'agent.log');

interface SavedConfig {
  serverUrl: string;
  hostId?: string;
  name?: string;
  inviteCode?: string;
}

function ensureConfigDir(): void {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

function loadConfig(): SavedConfig | null {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
    }
  } catch {
    // Ignore
  }
  return null;
}

function saveConfig(config: SavedConfig): void {
  ensureConfigDir();
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

function log(message: string): void {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] ${message}\n`;
  
  console.log(message);
  
  try {
    ensureConfigDir();
    fs.appendFileSync(LOG_FILE, line);
  } catch {
    // Ignore log write errors
  }
}

function printBanner(): void {
  console.log('');
  console.log('🦞 Clawner Agent v0.1.0');
  console.log('   Connect your host to ClawDay');
  console.log('');
}

const program = new Command();

program
  .name('clawner')
  .description('Clawner host agent - connects your machine to Clawner server')
  .version('0.1.2');

// JOIN - Connect to a ClawDay server
program
  .command('join <invite-code>')
  .description('Join a ClawDay instance with an invite code')
  .option('-s, --server <url>', 'Clawner server WebSocket URL', 'wss://clawday.com/ws')
  .option('-n, --name <name>', 'Host display name', os.hostname())
  .option('--no-save', 'Don\'t save configuration for reconnect')
  .action(async (inviteCode: string, options: { server: string; name: string; save: boolean }) => {
    printBanner();
    
    console.log(`Server:  ${options.server}`);
    console.log(`Code:    ${inviteCode}`);
    console.log(`Name:    ${options.name}`);
    console.log('');

    // Check OpenClaw status
    const version = commands.getVersion();
    if (version.success) {
      console.log(`OpenClaw: ${(version.data as any).version} ✓`);
    } else {
      console.log('OpenClaw: not installed ⚠');
      console.log('         Some features will be unavailable');
    }
    console.log('');

    const agent = new ClawnerAgent({
      serverUrl: options.server,
      inviteCode,
      name: options.name,
      onConnected: (hostId) => {
        log(`✅ Connected as: ${hostId}`);
        log('   Host is now managed by ClawDay');
        log('   Press Ctrl+C to disconnect');
        console.log('');

        if (options.save) {
          saveConfig({
            serverUrl: options.server,
            name: options.name,
            hostId,
          });
          log(`   Config saved to ${CONFIG_FILE}`);
        }
      },
      onDisconnected: (code, reason) => {
        log(`⚠️  Disconnected: ${code} ${reason}`);
      },
      onCommand: (cmd, result) => {
        log(`📥 ${cmd.type}: ${result.success ? '✓' : '✗'}`);
      },
      onError: (err) => {
        log(`❌ Error: ${err.message}`);
      },
    });

    // Handle shutdown
    process.on('SIGINT', () => {
      console.log('\n👋 Disconnecting...');
      agent.disconnect();
      process.exit(0);
    });

    process.on('SIGTERM', () => {
      agent.disconnect();
      process.exit(0);
    });

    try {
      await agent.connect();
    } catch (err) {
      console.error(`❌ Failed to connect: ${(err as Error).message}`);
      process.exit(1);
    }
  });

// RECONNECT - Reconnect using saved config
program
  .command('reconnect')
  .description('Reconnect using saved configuration')
  .action(async () => {
    printBanner();
    
    const config = loadConfig();
    if (!config || !config.hostId) {
      console.error('❌ No saved configuration found');
      console.error('   Run `clawner join <code>` first');
      process.exit(1);
    }

    console.log(`Server:  ${config.serverUrl}`);
    console.log(`Host ID: ${config.hostId}`);
    console.log(`Name:    ${config.name || os.hostname()}`);
    console.log('');

    const agent = new ClawnerAgent({
      serverUrl: config.serverUrl,
      hostId: config.hostId,
      name: config.name,
      onConnected: () => {
        log('✅ Reconnected successfully');
      },
      onDisconnected: (code, reason) => {
        log(`⚠️  Disconnected: ${code} ${reason}`);
      },
    });

    process.on('SIGINT', () => {
      agent.disconnect();
      process.exit(0);
    });

    try {
      await agent.connect();
    } catch (err) {
      console.error(`❌ Failed to reconnect: ${(err as Error).message}`);
      process.exit(1);
    }
  });

// STATUS - Show local status
program
  .command('status')
  .description('Show local host status and OpenClaw information')
  .option('--json', 'Output as JSON')
  .action((options: { json: boolean }) => {
    const status = commands.getFullStatus();
    
    if (options.json) {
      console.log(JSON.stringify(status.data, null, 2));
      return;
    }

    printBanner();
    
    const data = status.data as any;
    
    console.log('📊 Host Status');
    console.log('─'.repeat(40));
    console.log(`Hostname:     ${data.system.hostname}`);
    console.log(`Platform:     ${data.system.platform} (${data.system.arch})`);
    console.log(`Uptime:       ${Math.floor(data.system.uptime / 3600)}h ${Math.floor((data.system.uptime % 3600) / 60)}m`);
    console.log(`Memory:       ${Math.round(data.system.freeMemory / 1024 / 1024 / 1024 * 10) / 10}GB / ${Math.round(data.system.totalMemory / 1024 / 1024 / 1024 * 10) / 10}GB`);
    console.log(`CPUs:         ${data.system.cpuCount}`);
    console.log(`Load:         ${data.system.loadAvg.map((l: number) => l.toFixed(2)).join(', ')}`);
    console.log('');
    
    console.log('🦞 OpenClaw');
    console.log('─'.repeat(40));
    if (data.openclawInstalled) {
      console.log(`Version:      ${data.openclawVersion}`);
      
      if (data.gateway) {
        console.log(`Gateway:      ${data.gateway.running ? 'running ✓' : 'stopped'}`);
      }
      
      if (data.agents?.agents) {
        console.log(`Agents:       ${data.agents.agents.length}`);
        for (const agent of data.agents.agents) {
          console.log(`              - ${agent.name || agent.id}${agent.emoji ? ` ${agent.emoji}` : ''}`);
        }
      }
    } else {
      console.log('Status:       Not installed');
      console.log('');
      console.log('Install with: npm install -g openclaw');
    }
    console.log('');
    
    // Connection status
    const config = loadConfig();
    console.log('🔗 ClawDay Connection');
    console.log('─'.repeat(40));
    if (config?.hostId) {
      console.log(`Host ID:      ${config.hostId}`);
      console.log(`Server:       ${config.serverUrl}`);
      console.log('Status:       Configured (run `clawner reconnect` to connect)');
    } else {
      console.log('Status:       Not configured');
      console.log('Setup:        Run `clawner join <invite-code>`');
    }
    console.log('');
  });

// CONFIG - Show or edit configuration
program
  .command('config')
  .description('Show or edit configuration')
  .option('--server <url>', 'Set server URL')
  .option('--name <name>', 'Set host name')
  .option('--clear', 'Clear all configuration')
  .option('--json', 'Output as JSON')
  .action((options: { server?: string; name?: string; clear?: boolean; json?: boolean }) => {
    if (options.clear) {
      try {
        fs.unlinkSync(CONFIG_FILE);
        console.log('✅ Configuration cleared');
      } catch {
        console.log('No configuration to clear');
      }
      return;
    }

    let config = loadConfig() || { serverUrl: 'wss://clawday.com/ws' };

    if (options.server || options.name) {
      if (options.server) config.serverUrl = options.server;
      if (options.name) config.name = options.name;
      saveConfig(config);
      console.log('✅ Configuration updated');
    }

    if (options.json) {
      console.log(JSON.stringify(config, null, 2));
    } else {
      console.log('');
      console.log('📋 Configuration');
      console.log('─'.repeat(40));
      console.log(`Server:   ${config.serverUrl}`);
      console.log(`Name:     ${config.name || '(hostname)'}`);
      console.log(`Host ID:  ${config.hostId || '(not joined)'}`);
      console.log(`File:     ${CONFIG_FILE}`);
      console.log('');
    }
  });

// GATEWAY - Control OpenClaw gateway
program
  .command('gateway <action>')
  .description('Control OpenClaw gateway (start|stop|restart|status)')
  .action((action: string) => {
    let result: commands.CommandResult;
    
    switch (action) {
      case 'start':
        result = commands.startGateway({ background: true });
        break;
      case 'stop':
        result = commands.stopGateway();
        break;
      case 'restart':
        result = commands.restartGateway();
        break;
      case 'status':
        result = commands.getGatewayStatus();
        break;
      default:
        console.error(`Unknown action: ${action}`);
        console.error('Valid actions: start, stop, restart, status');
        process.exit(1);
    }

    if (result.success) {
      console.log(JSON.stringify(result.data, null, 2));
    } else {
      console.error(`❌ ${result.error}`);
      process.exit(1);
    }
  });

// AGENTS - List OpenClaw agents
program
  .command('agents')
  .description('List OpenClaw agents')
  .option('--json', 'Output as JSON')
  .action((options: { json: boolean }) => {
    const result = commands.listAgents();
    
    if (!result.success) {
      console.error(`❌ ${result.error}`);
      process.exit(1);
    }

    if (options.json) {
      console.log(JSON.stringify(result.data, null, 2));
      return;
    }

    const data = result.data as any;
    const agents = data.agents || [];
    
    if (agents.length === 0) {
      console.log('No agents configured');
      return;
    }

    console.log('');
    console.log('🤖 OpenClaw Agents');
    console.log('─'.repeat(40));
    for (const agent of agents) {
      console.log(`  ${agent.emoji || '•'} ${agent.name || agent.id}`);
      if (agent.bindings?.length) {
        console.log(`    → ${agent.bindings.join(', ')}`);
      }
    }
    console.log('');
  });

// DOCTOR - Run health checks
program
  .command('doctor')
  .description('Run OpenClaw health checks')
  .action(() => {
    const result = commands.runDoctor();
    
    if (result.success) {
      console.log((result.data as any).report);
    } else {
      console.error(`❌ ${result.error}`);
      process.exit(1);
    }
  });

// UPDATE - Update OpenClaw
program
  .command('update')
  .description('Update OpenClaw to the latest version')
  .action(() => {
    console.log('📦 Updating OpenClaw...');
    const result = commands.updateOpenClaw();
    
    if (result.success) {
      const data = result.data as any;
      console.log(`✅ ${data.message}`);
      if (data.version) {
        console.log(`   Version: ${data.version}`);
      }
    } else {
      console.error(`❌ ${result.error}`);
      process.exit(1);
    }
  });

// LOGS - Show agent logs
program
  .command('logs')
  .description('Show Clawner agent logs')
  .option('-n, --lines <number>', 'Number of lines to show', '50')
  .option('-f, --follow', 'Follow log output')
  .action((options: { lines: string; follow: boolean }) => {
    if (!fs.existsSync(LOG_FILE)) {
      console.log('No logs yet');
      return;
    }

    const lines = parseInt(options.lines, 10) || 50;
    const content = fs.readFileSync(LOG_FILE, 'utf-8');
    const allLines = content.split('\n').filter(l => l.trim());
    const lastLines = allLines.slice(-lines);
    
    console.log(lastLines.join('\n'));
    
    if (options.follow) {
      console.log('\n--- Following logs (Ctrl+C to stop) ---\n');
      
      let position = fs.statSync(LOG_FILE).size;
      
      const watcher = fs.watch(LOG_FILE, () => {
        const stat = fs.statSync(LOG_FILE);
        if (stat.size > position) {
          const fd = fs.openSync(LOG_FILE, 'r');
          const buffer = Buffer.alloc(stat.size - position);
          fs.readSync(fd, buffer, 0, buffer.length, position);
          fs.closeSync(fd);
          process.stdout.write(buffer.toString());
          position = stat.size;
        }
      });
      
      process.on('SIGINT', () => {
        watcher.close();
        process.exit(0);
      });
    }
  });

// Parse and run
program.parse();

// If no command specified, show help
if (!process.argv.slice(2).length) {
  printBanner();
  program.outputHelp();
}
