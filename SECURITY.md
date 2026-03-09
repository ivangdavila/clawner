# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 0.1.x   | :white_check_mark: |

## Reporting a Vulnerability

If you discover a security vulnerability, please report it by emailing:

**ivangdavila@gmail.com**

Please include:

1. Description of the vulnerability
2. Steps to reproduce
3. Potential impact
4. Suggested fix (if any)

### What to expect

- **Response time**: Within 48 hours
- **Updates**: You'll receive updates on the progress
- **Credit**: Security researchers will be credited (unless anonymity is requested)

### Please do NOT

- Open public issues for security vulnerabilities
- Exploit vulnerabilities beyond what's necessary to demonstrate the issue
- Share vulnerability details publicly before a fix is released

## Security Best Practices

When deploying Clawner:

1. **Use secure WebSocket connections (wss://)** in production
2. **Rotate invite codes** regularly
3. **Run behind a reverse proxy** (nginx, Caddy) with TLS
4. **Limit network access** to trusted hosts only
5. **Keep OpenClaw updated** on all connected hosts

Thank you for helping keep Clawner secure!
