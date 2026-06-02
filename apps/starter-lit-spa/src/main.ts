// Custom-element registrations only — no framework runtime, no virtual DOM,
// no client router. URL handling is a hand-rolled "watch popstate" pattern
// inside the post-detail element.
import './post-list';
import './post-detail';

// Trivial hash-based routing. If the URL is /posts/:slug, render the
// <post-detail> element instead of <post-list>.
function render() {
  const app = document.getElementById('app');
  if (!app) return;
  const match = window.location.pathname.match(/^\/posts\/(.+)$/);
  if (match) {
    app.innerHTML = `<post-detail slug="${match[1]}"></post-detail>`;
  } else {
    app.innerHTML = '<post-list></post-list>';
  }
}

window.addEventListener('popstate', render);
render();
