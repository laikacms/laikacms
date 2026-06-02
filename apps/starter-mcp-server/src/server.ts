#!/usr/bin/env -S node --import tsx
/**
 * LaikaCMS Model Context Protocol (MCP) server.
 *
 * Exposes the documents repo as MCP tools so AI agents (Claude Desktop,
 * ChatGPT desktop, Cursor, Continue, any MCP-aware client) can read and
 * write LaikaCMS content directly. The server speaks MCP over stdio —
 * the standard transport that MCP clients spawn as a subprocess.
 *
 * Tools exposed:
 *   - laikacms.list_posts  — list published posts in a folder
 *   - laikacms.get_post    — read a published post
 *   - laikacms.create_draft — create an unpublished post
 *   - laikacms.publish     — publish an unpublished post
 *
 * Connect to Claude Desktop:
 *   ~/Library/Application Support/Claude/claude_desktop_config.json
 *     {
 *       "mcpServers": {
 *         "laikacms": {
 *           "command": "node",
 *           "args": ["--import", "tsx", "/path/to/this/src/server.ts"],
 *           "env": { "LAIKA_CONTENT_DIR": "/path/to/your/content" }
 *         }
 *       }
 *     }
 */
import { resolve } from 'node:path';

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

import { createEmbeddedLaika, minimalBlogConfig } from '@laikacms/decap-integrations/embedded';
import { collectStream, runTask } from 'laikacms/compat';
import { NotFoundError } from 'laikacms/core';

const CONTENT_DIR = resolve(process.env.LAIKA_CONTENT_DIR ?? './content');

const laika = createEmbeddedLaika({
  contentDir: CONTENT_DIR,
  decapConfig: minimalBlogConfig(),
  basePath: '/api/decap',
  auth: { mode: 'dev' },
});

const server = new Server(
  {
    name: 'laikacms',
    version: '0.0.1',
  },
  {
    capabilities: { tools: {} },
  },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'laikacms.list_posts',
      description: 'List published posts in a folder under the LaikaCMS content root.',
      inputSchema: {
        type: 'object',
        properties: {
          folder: {
            type: 'string',
            description: 'Folder name to list (default: "posts").',
          },
          limit: {
            type: 'number',
            description: 'Maximum number of posts to return (default: 100).',
          },
        },
      },
    },
    {
      name: 'laikacms.get_post',
      description: 'Read a single published post by slug. Returns title, body, date, and raw content object.',
      inputSchema: {
        type: 'object',
        required: ['slug'],
        properties: {
          slug: {
            type: 'string',
            description: 'Post slug (e.g. "hello-world" → resolves to posts/hello-world).',
          },
        },
      },
    },
    {
      name: 'laikacms.create_draft',
      description: 'Create a new unpublished (draft) post.',
      inputSchema: {
        type: 'object',
        required: ['slug', 'title', 'body'],
        properties: {
          slug: { type: 'string', description: 'URL-friendly identifier' },
          title: { type: 'string', description: 'Post title' },
          body: { type: 'string', description: 'Markdown body' },
        },
      },
    },
    {
      name: 'laikacms.publish',
      description: 'Publish an existing draft post.',
      inputSchema: {
        type: 'object',
        required: ['slug'],
        properties: {
          slug: { type: 'string', description: 'Post slug to publish' },
        },
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async request => {
  const { name, arguments: args } = request.params;

  try {
    if (name === 'laikacms.list_posts') {
      const folder = (args?.folder as string) ?? 'posts';
      const limit = (args?.limit as number) ?? 100;
      const { items } = await collectStream(
        laika.documents.listRecords({
          folder,
          depth: 1,
          pagination: { offset: 0, limit },
          type: 'published',
        }),
      );
      const posts = items
        .filter(i => i.type === 'published')
        .map(item => {
          const content = ((item as { content?: Record<string, unknown> }).content ?? {}) as Record<
            string,
            unknown
          >;
          const key = (item as { key: string }).key;
          return {
            slug: key.replace(/^posts\//, '').replace(/\.md$/, ''),
            key,
            title: (content.title as string) ?? null,
            date: (content.date as string) ?? null,
          };
        });
      return { content: [{ type: 'text', text: JSON.stringify({ posts }, null, 2) }] };
    }

    if (name === 'laikacms.get_post') {
      const slug = args?.slug as string;
      try {
        const doc = await runTask(laika.documents.getDocument(`posts/${slug}`));
        return { content: [{ type: 'text', text: JSON.stringify(doc, null, 2) }] };
      } catch (err) {
        if (err instanceof NotFoundError) {
          return {
            isError: true,
            content: [{ type: 'text', text: `Post not found: posts/${slug}` }],
          };
        }
        throw err;
      }
    }

    if (name === 'laikacms.create_draft') {
      const { slug, title, body } = args as { slug: string, title: string, body: string };
      const draft = await runTask(
        laika.documents.createUnpublished({
          key: `posts/${slug}`,
          status: 'draft',
          language: 'en' as never,
          content: { title, body, date: new Date().toISOString() } as never,
        } as never),
      );
      return {
        content: [
          { type: 'text', text: `Created draft posts/${slug}:\n${JSON.stringify(draft, null, 2)}` },
        ],
      };
    }

    if (name === 'laikacms.publish') {
      const slug = args?.slug as string;
      try {
        const doc = await runTask(laika.documents.publish(`posts/${slug}`));
        return {
          content: [
            { type: 'text', text: `Published posts/${slug}:\n${JSON.stringify(doc, null, 2)}` },
          ],
        };
      } catch (err) {
        if (err instanceof NotFoundError) {
          return {
            isError: true,
            content: [{ type: 'text', text: `Draft not found: posts/${slug}` }],
          };
        }
        throw err;
      }
    }

    return {
      isError: true,
      content: [{ type: 'text', text: `Unknown tool: ${name}` }],
    };
  } catch (err) {
    return {
      isError: true,
      content: [{ type: 'text', text: `Error: ${(err as Error).message}` }],
    };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
// eslint-disable-next-line no-console
console.error(`LaikaCMS MCP server connected · content dir: ${CONTENT_DIR}`);
