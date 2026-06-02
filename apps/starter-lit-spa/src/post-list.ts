import { html, LitElement, type TemplateResult } from 'lit';
import { customElement, state } from 'lit/decorators.js';

interface PostListItem {
  key: string;
  slug: string;
  title: string | null;
}

@customElement('post-list')
export class PostList extends LitElement {
  @state()
  private posts: PostListItem[] = [];
  @state()
  private loaded = false;

  override createRenderRoot() {
    // Render to light DOM so the page's inherited styles apply.
    return this;
  }

  override async connectedCallback() {
    super.connectedCallback();
    const res = await fetch('/api/posts');
    const body = (await res.json()) as {
      posts: Array<{ key: string, content?: Record<string, unknown> }>,
    };
    this.posts = body.posts.map(p => ({
      key: p.key,
      slug: p.key.replace(/^posts\//, '').replace(/\.md$/, ''),
      title: (p.content?.title as string) ?? null,
    }));
    this.loaded = true;
  }

  private navigate(e: Event, slug: string) {
    e.preventDefault();
    window.history.pushState({}, '', `/posts/${slug}`);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }

  override render(): TemplateResult {
    return html`
      <section>
        <p>
          Edit posts at <a href="/admin">/admin</a> (Decap CMS). This page is a Web Components
          SPA — Lit-based custom elements, no framework runtime.
        </p>
        <ul style="list-style: none; padding: 0;">
          ${
      !this.loaded
        ? html`<li><em>Loading…</em></li>`
        : this.posts.length === 0
        ? html`<li><em>No posts yet — add one in the admin UI.</em></li>`
        : this.posts.map(
          p =>
            html`
                  <li style="margin-bottom: 1rem;">
                    <a href="/posts/${p.slug}" @click=${(e: Event) => this.navigate(e, p.slug)}>
                      ${p.title ?? p.slug}
                    </a>
                  </li>
                `,
        )
    }
        </ul>
      </section>
    `;
  }
}
