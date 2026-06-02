import router from '@adonisjs/core/services/router';

const DecapController = () => import('#controllers/decap_controller');
const BlogController = () => import('#controllers/blog_controller');

/**
 * Decap JSON:API — all HTTP methods forwarded to laika.fetch.
 *
 * AdonisJS parses request bodies by default (bodyParser middleware in kernel.ts).
 * For these routes we need the RAW body so laika.fetch can read it.
 * See DecapController for the body-handling approach.
 */
router.any('/api/decap/*', [DecapController, 'handle']);

/** Decap admin shell — standalone HTML page, not an AdonisJS view. */
router.get('/admin', [DecapController, 'admin']);

/** Blog routes */
router.get('/', [BlogController, 'index']);
router.get('/blog/:slug', [BlogController, 'show']);

/** Static uploads are served by the built-in static file middleware from /public */
