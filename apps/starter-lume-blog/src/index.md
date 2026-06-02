---
layout: base.njk
title: My Blog
---

<h1>My Blog</h1>

<p>
  Edit content at <a href="http://localhost:3001/admin" target="_blank">http://localhost:3001/admin</a>
  (requires <code>pnpm admin:dev</code> running).
</p>

{% if search.pages("type=post", "date=desc") | length > 0 %}
<ul class="post-list">
  {% for post in search.pages("type=post", "date=desc") %}
  <li>
    <a href="{{ post.url }}">{{ post.title or post.data.slug }}</a>
    {% if post.date %}
    <time>{{ post.date | date("DATE") }}</time>
    {% endif %}
  </li>
  {% endfor %}
</ul>
{% else %}
<p>No posts yet. Open the admin to write your first post.</p>
{% endif %}
