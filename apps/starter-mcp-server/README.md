# `@laikacms/starter-mcp-server`

LaikaCMS exposed as a **[Model Context Protocol](https://modelcontextprotocol.io) server** — AI
agents (Claude Desktop, ChatGPT desktop, Cursor, Continue, any MCP-aware client) can list, read, and
write your content directly via stdio.

Use this when you want:

- **AI-native content workflows.** "Hey Claude, summarize my last 5 posts and draft a roundup."
- **Headless content editing through a chat client.** No web admin needed.
- **Integration with agent frameworks** (LangChain MCP, OpenAI agents SDK, etc.).

## Tools exposed

| Tool                    | Description                                           |
| ----------------------- | ----------------------------------------------------- |
| `laikacms.list_posts`   | List published posts in a folder (default: `posts`).  |
| `laikacms.get_post`     | Read a single published post by slug.                 |
| `laikacms.create_draft` | Create an unpublished post (`slug`, `title`, `body`). |
| `laikacms.publish`      | Publish an existing draft.                            |

This is intentionally minimal — extend `src/server.ts` to add `delete`, `update`, asset upload,
revision listing, etc. as your agent needs them.

## Wire up Claude Desktop

1. Install the workspace dependencies: `pnpm install`.
2. Open Claude Desktop config:
   - macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
   - Windows: `%APPDATA%\Claude\claude_desktop_config.json`
3. Paste the `mcpServers` entry from
   [`claude_desktop_config.example.json`](./claude_desktop_config.example.json), replacing the two
   `REPLACE_WITH_ABSOLUTE_PATH` placeholders.
4. Restart Claude Desktop. The four tools appear in the tool list with the prefix `laikacms.`.

## Wire up Cursor / Continue / other clients

Any MCP client that supports stdio transports works. The launch command is:

```bash
node --import tsx /absolute/path/to/apps/starter-mcp-server/src/server.ts
```

with `LAIKA_CONTENT_DIR` pointing at your content root.

## Test from the shell

The MCP SDK ships a CLI inspector — use it to verify the server before wiring it into a client:

```bash
pnpm dlx @modelcontextprotocol/inspector \
  node --import tsx ./src/server.ts
```

That gives you a UI to call each tool and see the responses.

## Layout

```
apps/starter-mcp-server/
├── claude_desktop_config.example.json
├── content/posts/hello-world.md
├── src/server.ts                # MCP server, ~140 LOC
└── tsconfig.json
```

## Production hardening

- **Authorization.** stdio MCP servers run with the user's local file system permissions — any agent
  that can spawn this process can write any file inside `LAIKA_CONTENT_DIR`. Lock down the content
  root (e.g. a sandbox dir) before exposing to less-trusted agents.
- **Audit log.** Wrap each tool handler to append a row to a local audit file so you can review what
  the agent changed.
- **Rate limiting.** Add a per-tool token-bucket if you're worried about runaway agent loops.

## Why this matters

LaikaCMS's repository layer is "the API" — JSON:API and GraphQL and tRPC are all just wire formats
over it. MCP is just one more wire format, this time aimed at AI agents instead of web frontends.
Same repos, same shapes, same auth story; different transport.

See [`docs/starters.md`](../../docs/starters.md) and [`../../LLM-GUIDE.md`](../../LLM-GUIDE.md).
