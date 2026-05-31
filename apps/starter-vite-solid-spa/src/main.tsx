/* @refresh reload */
import { Route, Router } from '@solidjs/router';
import { render } from 'solid-js/web';

import { App } from './App';
import { Home } from './views/Home';
import { Post } from './views/Post';

const root = document.getElementById('app');
if (!root) throw new Error('#app not found');

render(
  () => (
    <Router root={App}>
      <Route path="/" component={Home} />
      <Route path="/posts/:slug" component={Post} />
    </Router>
  ),
  root,
);
