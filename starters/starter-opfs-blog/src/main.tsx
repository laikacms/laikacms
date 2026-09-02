/**
 * The blog itself — a small hash-routed SPA reading posts from the same
 * in-browser repositories the admin writes to. `#/post/<slug>` shows one
 * post; anything else shows the list.
 */
import { useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';

import { LaikaStream, LaikaTask } from 'laikacms/core';

import {
  currentMode,
  getRepositories,
  localAccessState,
  pickLocalFolder,
  requestLocalAccess,
  supportsLocalFolders,
  useOpfs,
} from './storage.js';

const POSTS_FOLDER = 'posts';

const slugOf = (key: string): string => key.replace(new RegExp(`^${POSTS_FOLDER}/`), '');

function useHashRoute(): string {
  const [hash, setHash] = useState(window.location.hash);
  useEffect(() => {
    const onChange = () => setHash(window.location.hash);
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return hash;
}

/**
 * The storage chooser. Mode switches reload the page so every module
 * (including the memoized repositories) starts over on the new root.
 */
function StorageBar({ needsPermission }: { needsPermission: boolean }) {
  const mode = currentMode();
  return (
    <p style={{ background: '#f1f5f9', padding: '8px 12px', display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
      <span>
        Storage: <strong>{mode === 'opfs' ? 'browser (OPFS)' : 'local folder'}</strong>
      </span>
      {mode === 'local' && (
        <button onClick={() => {
          useOpfs();
          window.location.reload();
        }}
        >
          Switch to browser storage
        </button>
      )}
      {needsPermission && (
        <button onClick={() => void requestLocalAccess().then(state => {
          if (state === 'granted') window.location.reload();
        })}
        >
          Restore folder access
        </button>
      )}
      {supportsLocalFolders
        ? (
          <button onClick={() => void pickLocalFolder().then(picked => {
            if (picked) window.location.reload();
          })}
          >
            {mode === 'local' ? 'Pick a different folder…' : 'Use a local folder…'}
          </button>
        )
        : <em>(picking a local folder needs a Chromium browser)</em>}
    </p>
  );
}

interface Post {
  title?: string,
  date?: string,
  description?: string,
  body?: string,
}

function PostPage({ slug }: { slug: string }) {
  const [post, setPost] = useState<Post | undefined>();
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    LaikaTask.runPromise(getRepositories().documents.getDocument(`${POSTS_FOLDER}/${slug}`))
      .then(document => setPost((document.content ?? {}) as Post))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, [slug]);

  if (error) {
    return (
      <p>
        Could not load this post: {error} <a href="#/">← Back</a>
      </p>
    );
  }
  if (!post) return <p>Loading…</p>;
  return (
    <article>
      <h1>{post.title ?? slug}</h1>
      {post.date && <time>{new Date(post.date).toLocaleDateString()}</time>}
      {post.description && (
        <p>
          <em>{post.description}</em>
        </p>
      )}
      <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit' }}>{post.body ?? ''}</pre>
      <p>
        <a href="#/">← Back</a>
      </p>
    </article>
  );
}

interface PostSummary {
  key: string,
  title: string,
}

function HomePage() {
  const [posts, setPosts] = useState<PostSummary[] | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [needsPermission, setNeedsPermission] = useState(false);

  const load = useCallback(() => {
    LaikaStream.runPromiseCollect(getRepositories().documents.listRecords({
      folder: POSTS_FOLDER,
      depth: 1,
      pagination: { perPage: 1000 },
      type: 'published',
    }))
      .then(({ data }) => {
        setPosts(
          data
            .filter(record => record.type === 'published')
            .map(record => ({
              key: record.key,
              title: typeof (record.content as Record<string, unknown>)?.['title'] === 'string'
                ? (record.content as Record<string, unknown>)['title'] as string
                : slugOf(record.key),
            })),
        );
      })
      .catch(async (err: unknown) => {
        // A missing posts/ folder just means nothing was written yet.
        const code = (err as { code?: string }).code;
        if (code === 'not_found') {
          setPosts([]);
          return;
        }
        // Typed web-fs permission errors → offer the one-click recovery.
        if (code === 'permission_prompt_required' || await localAccessState() === 'prompt') {
          setNeedsPermission(true);
        }
        setError(err instanceof Error ? err.message : String(err));
      });
  }, []);
  useEffect(load, [load]);

  return (
    <>
      <StorageBar needsPermission={needsPermission} />
      <h1>Blog</h1>
      {error && <p style={{ color: '#b91c1c' }}>{error}</p>}
      {posts && posts.length === 0 && (
        <p>
          No posts yet. <a href="/admin/">Open the CMS</a> and create one — it is stored
          {currentMode() === 'opfs'
            ? ' inside this browser (origin-private file system).'
            : ' as real files in your picked folder.'}
        </p>
      )}
      {posts && posts.length > 0 && (
        <ul>
          {posts.map(({ key, title }) => (
            <li key={key}>
              <a href={`#/post/${slugOf(key)}`}>{title}</a>
            </li>
          ))}
        </ul>
      )}
      <p>
        <a href="/admin/">Edit in CMS →</a>
      </p>
    </>
  );
}

function App() {
  const hash = useHashRoute();
  const match = /^#\/post\/(.+)$/.exec(hash);
  return match ? <PostPage slug={decodeURIComponent(match[1])} /> : <HomePage />;
}

createRoot(document.getElementById('root')!).render(<App />);
