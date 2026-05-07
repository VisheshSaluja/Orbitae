# Connecting AI Tools to Orbitae via MCP

Orbitae ships an MCP (Model Context Protocol) server that lets external AI tools — Claude Code, Cursor, Windsurf, and others — access your project context, run commands, query databases, and search your knowledge graph.

---

## Quick Setup

### 1. Get your MCP config from Orbitae

Open Orbitae and navigate to **Settings > MCP**. Copy the generated config JSON. It looks like this:

```json
{
  "mcpServers": {
    "orbitae": {
      "command": "/path/to/orbitae-mcp",
      "env": {
        "ORBITAE_MCP_TOKEN": "your-auth-token"
      }
    }
  }
}
```

Alternatively, use the in-app agent to ask: *"Give me my MCP config"* — it will call `get_mcp_client_config` and return the JSON.

### 2. Add to your MCP client

#### Claude Code

Add the `orbitae` entry to your Claude Code MCP settings file:

- **macOS/Linux:** `~/.claude/claude_code_config.json`
- **Project-level:** `.claude/mcp.json` in your repo root

```json
{
  "mcpServers": {
    "orbitae": {
      "command": "/path/to/orbitae-mcp",
      "env": {
        "ORBITAE_MCP_TOKEN": "your-auth-token"
      }
    }
  }
}
```

#### Cursor

Open **Cursor Settings > MCP Servers > Add Server** and paste the config. Or edit `~/.cursor/mcp.json` directly with the same format.

#### Other MCP Clients

Any MCP client that supports the stdio transport can connect. The config shape is the same — a command to launch the binary and the `ORBITAE_MCP_TOKEN` env var.

---

## Available Tools

Once connected, your AI tool can use these MCP tools:

| Tool | Description |
|------|-------------|
| `list_projects` | List all projects managed by Orbitae |
| `get_project_context` | Full context: project details, env vars, snippets, notes, links, git status, knowledge graph |
| `run_command` | Execute a shell command in a project directory |
| `query_database` | Run a read-only SQL query against a project's database connection |
| `search_knowledge` | Search the project's knowledge graph (architecture, conventions, runbooks) |
| `read_notes` | Get all notes for a project |
| `get_secrets` | List secret key names (values are NOT returned) |

## Authentication

The MCP server uses a token-based auth system:

1. Orbitae generates a random token on first launch and stores it in your system keychain
2. The token is passed to the MCP server via the `ORBITAE_MCP_TOKEN` environment variable
3. On startup, the server validates the token against the keychain before accepting connections
4. To regenerate the token (invalidates all existing client configs), use **Settings > MCP > Regenerate Token**

## Architecture

```
AI Tool (Claude Code / Cursor)
    │
    │  launches via command + env
    ▼
orbitae-mcp (stdio binary)
    │
    │  validates ORBITAE_MCP_TOKEN against keychain
    │  connects to same SQLite database as Orbitae
    ▼
Orbitae Database (~/Library/Application Support/com.orbitae.app/orbitae.db)
```

The MCP server is a standalone Rust binary that shares the same database as the Orbitae desktop app. It uses JSON-RPC over stdio (the standard MCP transport). Each MCP client launches its own instance of the server.

## Troubleshooting

**"ORBITAE_MCP_TOKEN environment variable is required"**
Your MCP client config is missing the `env` block. Copy the full config from Orbitae Settings > MCP.

**"MCP auth token not found in keychain"**
Launch Orbitae at least once — it generates the token on first startup.

**"Invalid MCP auth token"**
The token was regenerated. Get the new config from Orbitae Settings > MCP and update your client.

**Server not found / command not found**
The binary path in your config may be stale. Regenerate the config from Orbitae after an app update.
