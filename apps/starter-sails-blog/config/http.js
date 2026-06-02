/* eslint-disable @typescript-eslint/no-require-imports */
'use strict';

// Sails exposes the underlying Express instance via its http hook.
// We insert a targeted raw-body middleware for /api/decap/* BEFORE the
// router so the controller receives req.body as a Buffer, not a parsed object.
//
// Without this, Sails' default body-parser would either consume the stream or
// return undefined, making it impossible to forward the exact bytes to
// laika.fetch().

const express = require('express');
const rawParser = express.raw({ type: '*/*', limit: '50mb' });

module.exports.http = {
  middleware: {
    rawDecapBody: function(req, res, next) {
      if (req.path && req.path.startsWith('/api/decap')) {
        return rawParser(req, res, next);
      }
      return next();
    },

    // Middleware execution order.  'rawDecapBody' must come before 'router'
    // so that req.body is populated before the controller action runs.
    order: [
      'rawDecapBody',
      'cookieParser',
      'compress',
      'poweredBy',
      'router',
      'www',
      'favicon',
    ],
  },
};
