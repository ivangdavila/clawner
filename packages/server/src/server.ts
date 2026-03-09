// Clawner Server - Main entry point
import { Clawner, HostConnection, HeartbeatData } from './index.js';

const PORT = parseInt(process.env.PORT || '9000', 10);

// Store for tracking host data
const hostData: Map<string, {
  heartbeats: HeartbeatData[];
  events: Array<{ timestamp: Date; type: string; data: unknown }>;
}> = new Map();

const clawner = new Clawner({
  port: PORT,
  
  onHostConnect: (host: HostConnection) => {
    console.log(`[Clawner] ✅ Host connected: ${host.name} (${host.id})`);
    console.log(`          IP: ${host.ipAddress}`);
    console.log(`          OpenClaw: ${host.openclawVersion || 'not installed'}`);
    console.log(`          Capabilities: ${host.capabilities?.join(', ') || 'none'}`);
    
    // Initialize tracking
    hostData.set(host.id, {
      heartbeats: [],
      events: [{
        timestamp: new Date(),
        type: 'connected',
        data: { name: host.name, ip: host.ipAddress }
      }]
    });
  },
  
  onHostDisconnect: (hostId: string) => {
    console.log(`[Clawner] ⚠️ Host disconnected: ${hostId}`);
    
    const data = hostData.get(hostId);
    if (data) {
      data.events.push({
        timestamp: new Date(),
        type: 'disconnected',
        data: {}
      });
    }
  },
  
  onHostHeartbeat: (hostId: string, data: HeartbeatData) => {
    const host = clawner.getHost(hostId);
    
    // Store heartbeat (keep last 100)
    const hostInfo = hostData.get(hostId);
    if (hostInfo) {
      hostInfo.heartbeats.push(data);
      if (hostInfo.heartbeats.length > 100) {
        hostInfo.heartbeats.shift();
      }
    }
    
    // Log summary
    const parts: string[] = [];
    if (data.gateway) {
      parts.push(`gateway: ${data.gateway.running ? 'running' : 'stopped'}`);
    }
    if (data.agents?.length) {
      parts.push(`agents: ${data.agents.length}`);
    }
    if (data.system) {
      const load = data.system.loadAvg[0].toFixed(2);
      const memPct = Math.round((1 - data.system.freeMemory / data.system.totalMemory) * 100);
      parts.push(`load: ${load}, mem: ${memPct}%`);
    }
    
    console.log(`[Clawner] 💓 ${host?.name || hostId}: ${parts.join(', ')}`);
  },
});

// Start server
await clawner.start();

console.log('');
console.log('═'.repeat(60));
console.log('🦞 CLAWNER SERVER');
console.log('═'.repeat(60));
console.log('');
console.log(`WebSocket:  ws://localhost:${PORT}`);
console.log(`REST API:   http://localhost:${PORT}`);
console.log(`Dashboard:  http://localhost:3000 (if running)`);
console.log('');
console.log('Endpoints:');
console.log('  GET  /health              Health check');
console.log('  GET  /hosts               List all hosts');
console.log('  GET  /hosts/:id           Get host details');
console.log('  POST /hosts/:id/command   Send command to host');
console.log('  POST /invite              Generate invite code');
console.log('');

// Generate initial invite code
const code = clawner.generateInviteCode('default-host');
console.log(`Initial invite code: ${code}`);
console.log('');
console.log('Connect a host:');
console.log(`  clawner join ${code} -s ws://<this-server>:${PORT}`);
console.log('');

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n[Clawner] Shutting down...');
  await clawner.stop();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await clawner.stop();
  process.exit(0);
});

// Export for external use
export { clawner, hostData };
