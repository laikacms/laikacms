import router from '@adonisjs/core/services/router';
import server from '@adonisjs/core/services/server';

/**
 * The error handler is used to convert an exception to a HTTP response.
 */
server.errorHandler(() => import('#exceptions/handler'));

/**
 * The server middleware stack runs on every HTTP request.
 *
 * NOTE: Do NOT add bodyParser middleware globally when using LaikaCMS.
 * The Decap JSON:API handler (laika.fetch) reads the raw body stream.
 * If a body parser drains the stream first, laika.fetch receives an empty body.
 *
 * Instead, if you need body parsing for other routes, register it on those
 * specific routes only (see start/routes.ts).
 */
server.use([
  () => import('@adonisjs/core/bodyparser_middleware'),
]);

/**
 * Named middleware collection defined for route-level middleware reference.
 */
export const middleware = router.named({
  // noBodyParser: () => import('#middleware/no_body_parser_middleware'),
});
