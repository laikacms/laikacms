import { useData } from 'vike-react/useData';

import type { Data } from './+data.js';

export default function Page() {
  const { title, date, description, body, slug } = useData<Data>();

  return (
    <article style={{ fontFamily: 'sans-serif', maxWidth: 640, margin: '2rem auto', padding: '0 1rem' }}>
      <h1>{title ?? slug}</h1>
      {date && <time style={{ color: '#666' }}>{new Date(date).toLocaleDateString()}</time>}
      {description && (
        <p>
          <em>{description}</em>
        </p>
      )}
      {/* body is raw markdown — pipe through remark/rehype for production HTML rendering */}
      <pre
        style={{
          whiteSpace: 'pre-wrap',
          fontFamily: 'inherit',
          background: '#f6f8fa',
          padding: '1rem',
          borderRadius: 4,
        }}
      >
        {body}
      </pre>
      <p>
        <a href="/">← Back to posts</a>
      </p>
    </article>
  );
}
