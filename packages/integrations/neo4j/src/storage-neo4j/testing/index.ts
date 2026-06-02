import type { StorageObjectContent } from 'laikacms/storage';
import type { StorageContractCase } from 'laikacms/storage/testing';

import { type CypherResult, type CypherStatement, Neo4jDataSource } from '../neo4j-datasource.js';
import { Neo4jStorageRepository } from '../neo4j-storage-repository.js';

const API = 'http://neo4j-contract-test.internal:7474';
const DATABASE = 'neo4j';
const USER = 'neo4j';
const PASS = 'password';

const expectedAuth = `Basic ${btoa(`${USER}:${PASS}`)}`;

type NodeLabel = 'LaikaFile' | 'LaikaFolder';

interface MockNode {
  labels: Set<NodeLabel>;
  props: {
    path: string,
    parent: string,
    name: string,
    extension?: string,
    content?: string,
    createdAt?: string,
    updatedAt?: string,
  };
}

interface MockEdge {
  from: string;
  to: string;
  type: 'CHILD_OF';
}

const norm = (s: string): string => s.replace(/\s+/g, ' ').trim();
const nodeKey = (label: NodeLabel, path: string): string => `${label}:${path}`;

const createMockNeo4j = () => {
  const nodes = new Map<string, MockNode>();
  let edges: MockEdge[] = [];

  const hasOutgoingChildOf = (path: string): boolean => edges.some(e => e.from === path && e.type === 'CHILD_OF');
  const collectAtomNodes = (filterFn: (n: MockNode) => boolean): MockNode[] => [...nodes.values()].filter(filterFn);

  const evalStatement = (statement: CypherStatement): CypherResult => {
    const s = norm(statement.statement);
    const p = statement.parameters ?? {};

    // CREATE (f:LaikaFile {…}) RETURN f
    let m = s.match(
      /^CREATE \(f:LaikaFile \{path: \$path, parent: \$parent, name: \$name, extension: \$extension, content: \$content, createdAt: \$now, updatedAt: \$now\}\) RETURN f$/,
    );
    if (m) {
      const key = nodeKey('LaikaFile', String(p['path']));
      if (nodes.has(key)) {
        const err = new Error(`Already exists: ${key}`);
        throw Object.assign(err, { code: 'Neo.ClientError.Schema.ConstraintValidationFailed' });
      }
      const node: MockNode = {
        labels: new Set(['LaikaFile']),
        props: {
          path: String(p['path']),
          parent: String(p['parent']),
          name: String(p['name']),
          extension: String(p['extension']),
          content: String(p['content']),
          createdAt: String(p['now']),
          updatedAt: String(p['now']),
        },
      };
      nodes.set(key, node);
      return { columns: ['f'], data: [{ row: [node.props] }] };
    }

    // MATCH (f:Laika{File|Folder} {path}) MERGE (p:LaikaFolder {parent}) MERGE (f)-[:CHILD_OF]->(p)
    const linkMatch = s.match(
      /^MATCH \(f:(LaikaFile|LaikaFolder) \{path: \$path\}\) MERGE \(p:LaikaFolder \{path: \$parent\}\)/,
    );
    if (linkMatch && /MERGE \(f\)-\[:CHILD_OF\]->\(p\)/.test(s)) {
      const childLabel = linkMatch[1]! as NodeLabel;
      const folderKey = nodeKey('LaikaFolder', String(p['parent']));
      if (!nodes.has(folderKey)) {
        nodes.set(folderKey, {
          labels: new Set(['LaikaFolder']),
          props: {
            path: String(p['parent']),
            parent: String(p['parentParent'] ?? ''),
            name: String(p['parentName'] ?? p['parent']),
            createdAt: String(p['now']),
            updatedAt: String(p['now']),
          },
        });
      }
      if (!edges.some(e => e.from === String(p['path']) && e.to === String(p['parent']) && e.type === 'CHILD_OF')) {
        edges.push({ from: String(p['path']), to: String(p['parent']), type: 'CHILD_OF' });
      }
      void childLabel;
      return { columns: [], data: [] };
    }

    // MERGE (f:LaikaFolder {path}) ON CREATE SET … (standalone)
    if (
      /^MERGE \(f:LaikaFolder \{path: \$path\}\) ON CREATE SET f\.name = \$name, f\.parent = \$parent, f\.createdAt = \$now, f\.updatedAt = \$now$/
        .test(s)
    ) {
      const key = nodeKey('LaikaFolder', String(p['path']));
      if (!nodes.has(key)) {
        nodes.set(key, {
          labels: new Set(['LaikaFolder']),
          props: {
            path: String(p['path']),
            parent: String(p['parent']),
            name: String(p['name']),
            createdAt: String(p['now']),
            updatedAt: String(p['now']),
          },
        });
      }
      return { columns: [], data: [] };
    }

    // MATCH (f:LaikaFile {parent, name}) RETURN f LIMIT 1
    m = s.match(/^MATCH \(f:LaikaFile \{parent: \$parent, name: \$name\}\) RETURN f LIMIT 1$/);
    if (m) {
      const parent = String(p['parent']);
      const name = String(p['name']);
      const found = [...nodes.values()].find(
        n => n.labels.has('LaikaFile') && n.props.parent === parent && n.props.name === name,
      );
      return { columns: ['f'], data: found ? [{ row: [found.props] }] : [] };
    }

    // MATCH (f:LaikaFolder {path}) RETURN f LIMIT 1
    m = s.match(/^MATCH \(f:LaikaFolder \{path: \$path\}\) RETURN f LIMIT 1$/);
    if (m) {
      const found = nodes.get(nodeKey('LaikaFolder', String(p['path'])));
      return { columns: ['f'], data: found ? [{ row: [found.props] }] : [] };
    }

    // MATCH (f:LaikaFile {path}) SET f.content = $content, f.updatedAt = $now RETURN f
    if (/^MATCH \(f:LaikaFile \{path: \$path\}\) SET f\.content = \$content, f\.updatedAt = \$now RETURN f$/.test(s)) {
      const key = nodeKey('LaikaFile', String(p['path']));
      const node = nodes.get(key);
      if (node) {
        node.props.content = String(p['content']);
        node.props.updatedAt = String(p['now']);
        return { columns: ['f'], data: [{ row: [node.props] }] };
      }
      return { columns: ['f'], data: [] };
    }

    // MATCH (f:LaikaFile {path}) DETACH DELETE f
    if (/^MATCH \(f:LaikaFile \{path: \$path\}\) DETACH DELETE f$/.test(s)) {
      const path = String(p['path']);
      const key = nodeKey('LaikaFile', path);
      nodes.delete(key);
      edges = edges.filter(e => e.from !== path && e.to !== path);
      return { columns: [], data: [] };
    }

    // MATCH (p:LaikaFolder {path})<-[:CHILD_OF]-(c) RETURN c
    if (/^MATCH \(p:LaikaFolder \{path: \$parent\}\)<-\[:CHILD_OF\]-\(c\) RETURN c$/.test(s)) {
      const parentPath = String(p['parent']);
      const children = edges
        .filter(e => e.to === parentPath && e.type === 'CHILD_OF')
        .map(e => {
          const candidateFile = nodes.get(nodeKey('LaikaFile', e.from));
          const candidateFolder = nodes.get(nodeKey('LaikaFolder', e.from));
          return candidateFile ?? candidateFolder;
        })
        .filter((n): n is MockNode => n !== undefined);
      return { columns: ['c'], data: children.map(c => ({ row: [c.props] })) };
    }

    // Root listing: MATCH (n/c) WHERE (n:LaikaFile OR n:LaikaFolder) AND NOT (n)-[:CHILD_OF]->()
    if (
      /^MATCH \(([a-z])\) WHERE \(\1:LaikaFile OR \1:LaikaFolder\) AND NOT \(\1\)-\[:CHILD_OF\]->\(\) RETURN \1( LIMIT 1)?$/
        .test(s)
    ) {
      const limit1 = s.endsWith('LIMIT 1');
      const matches = collectAtomNodes(n => !hasOutgoingChildOf(n.props.path));
      const rows = matches.map(n => ({ row: [n.props] }));
      return { columns: [s.includes('RETURN n') ? 'n' : 'c'], data: limit1 ? rows.slice(0, 1) : rows };
    }

    // MATCH (c) WHERE c.parent = $parent RETURN c LIMIT 1
    if (/^MATCH \(c\) WHERE c\.parent = \$parent RETURN c LIMIT 1$/.test(s)) {
      const parent = String(p['parent']);
      const found = [...nodes.values()].find(n => n.props.parent === parent);
      return { columns: ['c'], data: found ? [{ row: [found.props] }] : [] };
    }

    throw new Error(`mock: unrecognised Cypher: ${s.slice(0, 200)}`);
  };

  const fetchImpl: typeof fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : (input as URL).toString();
    if (!url.startsWith(API)) return new Response('not found', { status: 404 });
    const expectedPath = `/db/${DATABASE}/tx/commit`;
    if (!url.endsWith(expectedPath) || (init?.method ?? 'GET').toUpperCase() !== 'POST') {
      return new Response('not found', { status: 404 });
    }
    const auth = (init?.headers as Record<string, string> | undefined)?.['Authorization'];
    if (auth !== expectedAuth) return new Response('Unauthorized', { status: 401 });

    const body = JSON.parse(init?.body as string) as { statements: CypherStatement[] };
    const results: CypherResult[] = [];
    const errors: Array<{ code: string, message: string }> = [];
    try {
      for (const stmt of body.statements) {
        results.push(evalStatement(stmt));
      }
    } catch (err) {
      const e = err as Error & { code?: string };
      errors.push({ code: e.code ?? 'Neo.ClientError.Unknown', message: e.message });
    }
    return new Response(JSON.stringify({ results, errors }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  return { nodes, edges, fetch: fetchImpl };
};

const makeSerializerRegistry = () => ({
  json: {
    format: { mediaType: 'application/json' } as never,
    serializeDocumentFileContents: async (content: unknown) => JSON.stringify(content),
    deserializeDocumentFileContents: async (raw: string) => JSON.parse(raw) as StorageObjectContent,
  },
});

export const neo4jContractCase: StorageContractCase = {
  name: 'Neo4jStorageRepository',
  async makeRepo() {
    const backend = createMockNeo4j();
    void backend.nodes;
    void backend.edges;
    const ds = new Neo4jDataSource({
      url: API,
      database: DATABASE,
      auth: { basic: { username: USER, password: PASS } },
      fetch: backend.fetch,
    });
    return new Neo4jStorageRepository({
      dataSource: ds,
      serializerRegistry: makeSerializerRegistry(),
      defaultFileExtension: 'json',
    });
  },
};
