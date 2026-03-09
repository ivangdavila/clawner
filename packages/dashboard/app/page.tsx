'use client';

import { useState, useEffect } from 'react';
import useSWR from 'swr';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:9000';

const fetcher = (url: string) => fetch(url).then(res => res.json());

interface Host {
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
  systemInfo?: {
    uptime: number;
    loadAvg: number[];
    freeMemory: number;
    totalMemory: number;
    cpuCount: number;
  };
  lastSeen: string;
  connectedAt?: string;
}

interface Health {
  status: string;
  hosts: number;
  connectedHosts: number;
}

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

function formatBytes(bytes: number): string {
  const gb = bytes / 1024 / 1024 / 1024;
  return `${gb.toFixed(1)} GB`;
}

function StatusBadge({ status }: { status: string }) {
  const colors = {
    connected: 'bg-green-100 text-green-800',
    disconnected: 'bg-red-100 text-red-800',
    pending: 'bg-yellow-100 text-yellow-800',
  };
  return (
    <span className={`px-2 py-1 rounded-full text-xs font-medium ${colors[status as keyof typeof colors] || 'bg-gray-100'}`}>
      {status}
    </span>
  );
}

function HostCard({ host, onCommand }: { host: Host; onCommand: (cmd: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);

  const sendCommand = async (type: string) => {
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/hosts/${host.id}/command`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type }),
      });
      const data = await res.json();
      console.log('Command result:', data);
      onCommand(`${type}: ${data.success ? 'Success' : data.error}`);
    } catch (err) {
      onCommand(`${type}: Error - ${err}`);
    }
    setLoading(false);
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
      <div className="p-6">
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-3">
              <div className={`w-3 h-3 rounded-full ${host.status === 'connected' ? 'bg-green-500' : 'bg-gray-300'}`} />
              <h3 className="text-lg font-semibold text-gray-900">{host.name}</h3>
            </div>
            <p className="text-sm text-gray-500 mt-1">{host.hostname || host.id}</p>
          </div>
          <StatusBadge status={host.status} />
        </div>

        <div className="mt-4 grid grid-cols-2 gap-4 text-sm">
          <div>
            <p className="text-gray-500">IP Address</p>
            <p className="font-medium">{host.ipAddress?.replace('::ffff:', '') || '-'}</p>
          </div>
          <div>
            <p className="text-gray-500">Platform</p>
            <p className="font-medium">{host.osInfo?.platform || '-'} ({host.osInfo?.arch || '-'})</p>
          </div>
          <div>
            <p className="text-gray-500">OpenClaw</p>
            <p className="font-medium">{host.openclawVersion || 'Not installed'}</p>
          </div>
          <div>
            <p className="text-gray-500">Last Seen</p>
            <p className="font-medium">{new Date(host.lastSeen).toLocaleTimeString()}</p>
          </div>
        </div>

        {host.systemInfo && (
          <div className="mt-4 pt-4 border-t border-gray-100">
            <div className="grid grid-cols-3 gap-4 text-sm">
              <div>
                <p className="text-gray-500">Uptime</p>
                <p className="font-medium">{formatUptime(host.systemInfo.uptime)}</p>
              </div>
              <div>
                <p className="text-gray-500">Load</p>
                <p className="font-medium">{host.systemInfo.loadAvg[0].toFixed(2)}</p>
              </div>
              <div>
                <p className="text-gray-500">Memory</p>
                <p className="font-medium">
                  {formatBytes(host.systemInfo.totalMemory - host.systemInfo.freeMemory)} / {formatBytes(host.systemInfo.totalMemory)}
                </p>
              </div>
            </div>
          </div>
        )}

        {host.capabilities && host.capabilities.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-1">
            {host.capabilities.map(cap => (
              <span key={cap} className="px-2 py-0.5 bg-gray-100 rounded text-xs text-gray-600">
                {cap}
              </span>
            ))}
          </div>
        )}
      </div>

      {host.status === 'connected' && (
        <div className="px-6 py-3 bg-gray-50 border-t border-gray-100 flex gap-2">
          <button
            onClick={() => sendCommand('get_status')}
            disabled={loading}
            className="px-3 py-1.5 text-sm bg-white border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50"
          >
            Status
          </button>
          <button
            onClick={() => sendCommand('gateway_status')}
            disabled={loading}
            className="px-3 py-1.5 text-sm bg-white border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50"
          >
            Gateway
          </button>
          <button
            onClick={() => sendCommand('list_agents')}
            disabled={loading}
            className="px-3 py-1.5 text-sm bg-white border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50"
          >
            Agents
          </button>
          <button
            onClick={() => sendCommand('doctor')}
            disabled={loading}
            className="px-3 py-1.5 text-sm bg-white border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50"
          >
            Doctor
          </button>
        </div>
      )}
    </div>
  );
}

export default function Dashboard() {
  const { data: health } = useSWR<Health>(`${API_URL}/health`, fetcher, { refreshInterval: 5000 });
  const { data: hosts, mutate } = useSWR<Host[]>(`${API_URL}/hosts`, fetcher, { refreshInterval: 3000 });
  const [logs, setLogs] = useState<string[]>([]);
  const [inviteCode, setInviteCode] = useState<string | null>(null);

  const addLog = (msg: string) => {
    setLogs(prev => [...prev.slice(-19), `[${new Date().toLocaleTimeString()}] ${msg}`]);
  };

  const generateInvite = async () => {
    try {
      const res = await fetch(`${API_URL}/invite`, { method: 'POST' });
      const data = await res.json();
      setInviteCode(data.code);
      addLog(`Generated invite code: ${data.code}`);
    } catch (err) {
      addLog(`Error generating invite: ${err}`);
    }
  };

  return (
    <div className="min-h-screen">
      {/* Header */}
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="text-2xl">🦞</span>
              <h1 className="text-xl font-bold text-gray-900">Clawner</h1>
            </div>
            <div className="flex items-center gap-4">
              {health && (
                <div className="flex items-center gap-2 text-sm">
                  <div className={`w-2 h-2 rounded-full ${health.status === 'ok' ? 'bg-green-500' : 'bg-red-500'}`} />
                  <span className="text-gray-600">
                    {health.connectedHosts} of {health.hosts} hosts connected
                  </span>
                </div>
              )}
              <button
                onClick={generateInvite}
                className="px-4 py-2 bg-black text-white rounded-lg text-sm font-medium hover:bg-gray-800"
              >
                + Add Host
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Invite Code Modal */}
      {inviteCode && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 max-w-md w-full mx-4">
            <h2 className="text-lg font-semibold mb-4">Add New Host</h2>
            <p className="text-sm text-gray-600 mb-4">
              Run this command on the host you want to connect:
            </p>
            <div className="bg-gray-900 text-green-400 p-4 rounded-lg font-mono text-sm mb-4 overflow-x-auto">
              clawner-agent join {inviteCode}
            </div>
            <p className="text-xs text-gray-500 mb-4">
              This code expires in 24 hours.
            </p>
            <button
              onClick={() => setInviteCode(null)}
              className="w-full py-2 bg-gray-100 rounded-lg text-sm font-medium hover:bg-gray-200"
            >
              Close
            </button>
          </div>
        </div>
      )}

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-6 py-8">
        {/* Hosts Grid */}
        <div className="mb-8">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">
            Connected Hosts
          </h2>
          {hosts && hosts.length > 0 ? (
            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
              {hosts.map(host => (
                <HostCard key={host.id} host={host} onCommand={addLog} />
              ))}
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
              <p className="text-gray-500 mb-4">No hosts connected yet</p>
              <button
                onClick={generateInvite}
                className="px-4 py-2 bg-black text-white rounded-lg text-sm font-medium hover:bg-gray-800"
              >
                Add your first host
              </button>
            </div>
          )}
        </div>

        {/* Activity Log */}
        {logs.length > 0 && (
          <div>
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Activity Log</h2>
            <div className="bg-gray-900 rounded-xl p-4 font-mono text-sm text-gray-300 max-h-64 overflow-y-auto">
              {logs.map((log, i) => (
                <div key={i}>{log}</div>
              ))}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
