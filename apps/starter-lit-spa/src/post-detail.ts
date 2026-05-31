import { html, LitElement, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

interface Post {
  title: string;
  body: string;
  date: string | null;
}

@customElement('post-detail')
export class PostDetail extends LitElement {
  @property({ type: String })
  slug = '';
  @state()
  private post: Post | null = null;
  @state()
  private notFound = false;

  override createRenderRoot() {
    return this;
  }

  override async connectedCallback() {
    super.connectedCallback();
    if (!this.slug) return;
    const res = await fetch(`/api/posts/${encodeURIComponent(this.slug)}`);
    if (res.status === 404) {
      this.notFound = true;
      return;
    }
    const body = (await res.json()) as { post: { content?: Record<string, unknown> } };
    const content = (body.post.content ?? {}) as Record<string, unknown>;
    this.post = {
      title: (content.title as string) ?? this.slug,
      body: (content.body as string) ?? '',
      date: (content.date as string) ?? null,
    };
  }

  override render(): TemplateResult {
    if (this.notFound) return html`<p>Post not found.</p>`;
    if (!this.post) return html`<p><em>Loading…</em></p>`;
    return html`
      <article>
        <h2 style="margin-bottom: 0.25rem;">${this.post.title}</h2>
        ${
      this.post.date
        ? html`<small style="color: #666;">${new Date(this.post.date).toLocaleDateString()}</small>`
        : null
    }
        <div style="margin-top: 1.5rem; white-space: pre-wrap;">${this.post.body}</div>
      </article>
    `;
  }
}
