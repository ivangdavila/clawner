# Contributing to Clawner

Thank you for your interest in contributing to Clawner! 🦞

## Getting Started

1. Fork the repository
2. Clone your fork: `git clone https://github.com/YOUR_USERNAME/clawner.git`
3. Install dependencies: `pnpm install`
4. Create a branch: `git checkout -b feature/your-feature`

## Development

```bash
# Start server and dashboard
pnpm dev

# Build all packages
pnpm build

# Run tests
pnpm test
```

## Project Structure

```
clawner/
├── packages/
│   ├── server/      # WebSocket server + REST API
│   ├── dashboard/   # Next.js web UI
│   └── agent/       # CLI agent (published to npm as "clawner")
└── docs/            # Documentation
```

## Pull Request Process

1. Update documentation if needed
2. Add tests for new features
3. Ensure all tests pass
4. Update the README if adding new commands/features
5. Submit PR to `main` branch

## Code Style

- Use TypeScript
- Follow existing code patterns
- Keep functions small and focused
- Add comments for complex logic

## Reporting Issues

- Use GitHub Issues
- Include steps to reproduce
- Include your environment (OS, Node version, OpenClaw version)

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
