<p align="center">
  <img src="https://raw.githubusercontent.com/ivangdavila/clawner/main/banner.webp" alt="Clawner" width="500">
</p>

# clawner

Remote orchestrator agent for [OpenClaw](https://openclaw.ai). Connect your hosts to a central Clawner server to monitor and manage OpenClaw deployments remotely.

## Installation

```bash
npm install -g clawner
```

## Quick Start

```bash
# Join a Clawner server
clawner join YOUR-INVITE-CODE -s ws://server:9000 -n "My Mac"

# Reconnect with saved config
clawner reconnect

# Check status
clawner status
```

## Commands

```bash
clawner join <code>       # Join a server with invite code
clawner reconnect         # Reconnect using saved config
clawner status            # Show local OpenClaw status
clawner config            # View saved configuration
clawner gateway <cmd>     # Control gateway (status|start|stop)
clawner agents            # List configured agents
clawner logs [-n lines]   # View gateway logs
clawner doctor            # Run health checks
clawner update            # Update OpenClaw
```

## Options

```bash
-s, --server <url>    Server WebSocket URL (ws://host:port)
-n, --name <name>     Host display name
-h, --help            Show help
```

## Requirements

- Node.js >= 18.0.0
- OpenClaw installed on the host

## License

MIT
