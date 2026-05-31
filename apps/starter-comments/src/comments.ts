import { collectStream, runTask } from 'laikacms/compat';

import { laika } from './laika.js';

export type CommentStatus = 'pending' | 'approved' | 'rejected';

export interface Comment {
  id: string;
  postSlug: string;
  author: string;
  body: string;
  createdAt: string;
  status: CommentStatus;
}

const FOLDER = 'comments';

function keyFor(id: string): string {
  return `${FOLDER}/${id}.md`;
}

function newId(): string {
  const buf = new Uint8Array(8);
  globalThis.crypto.getRandomValues(buf);
  return Array.from(buf, b => b.toString(16).padStart(2, '0')).join('');
}

function contentFrom(c: Comment): Record<string, unknown> {
  return {
    postSlug: c.postSlug,
    author: c.author,
    body: c.body,
    createdAt: c.createdAt,
    status: c.status,
  };
}

export async function createComment(
  input: Omit<Comment, 'id' | 'createdAt' | 'status'>,
): Promise<Comment> {
  const comment: Comment = {
    id: newId(),
    ...input,
    createdAt: new Date().toISOString(),
    status: 'pending',
  };
  await runTask(
    laika.documents.createDocument({
      key: keyFor(comment.id),
      type: 'published',
      status: 'published',
      language: 'und',
      content: contentFrom(comment),
    }),
  );
  return comment;
}

export async function listComments(opts: {
  postSlug?: string,
  status?: CommentStatus,
}): Promise<Comment[]> {
  const { items } = await collectStream(
    laika.documents.listRecords({
      folder: FOLDER,
      depth: 1,
      pagination: { offset: 0, limit: 1000 },
      type: 'published',
    }),
  );
  return items
    .filter(i => i.type === 'published')
    .map(item => {
      const key = (item as { key: string }).key;
      const content = ((item as { content?: Record<string, unknown> }).content ?? {}) as Record<
        string,
        unknown
      >;
      return {
        id: key.replace(/^comments\//, '').replace(/\.md$/, ''),
        postSlug: (content.postSlug as string) ?? '',
        author: (content.author as string) ?? '',
        body: (content.body as string) ?? '',
        createdAt: (content.createdAt as string) ?? '',
        status: (content.status as CommentStatus) ?? 'pending',
      };
    })
    .filter(c => (opts.postSlug ? c.postSlug === opts.postSlug : true))
    .filter(c => (opts.status ? c.status === opts.status : true))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function setStatus(id: string, status: CommentStatus): Promise<Comment | null> {
  const existing = (await listComments({})).find(c => c.id === id);
  if (!existing) return null;
  const updated: Comment = { ...existing, status };
  await runTask(
    laika.documents.updateDocument({
      key: keyFor(id),
      content: contentFrom(updated),
    }),
  );
  return updated;
}

export async function deleteComment(id: string): Promise<boolean> {
  const existing = (await listComments({})).find(c => c.id === id);
  if (!existing) return false;
  await runTask(laika.documents.deleteDocument(keyFor(id)));
  return true;
}
