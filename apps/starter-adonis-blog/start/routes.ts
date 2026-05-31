/**
 * AdonisJS routes — loaded at startup via the `preloads` array in adonisrc.ts.
 *
 * AdonisJS uses lazy controller imports to keep startup fast; the controller
 * module is only loaded when the route is first hit.
 */
import router from '@adonisjs/core/services/router';

const PostsController = () => import('#controllers/posts_controller');
const DecapController = () => import('#controllers/decap_controller');

// Blog JSON API — consumed by the SPA in public/index.html
router.get('/posts', [PostsController, 'index']);
router.get('/posts/:slug', [PostsController, 'show']);

// Decap CMS JSON:API proxy — catch all HTTP methods and sub-paths
router.any('/api/decap/*', [DecapController, 'proxy']);
