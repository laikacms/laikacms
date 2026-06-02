/* eslint-disable @typescript-eslint/no-require-imports */
'use strict';

// Sails.js entry point.  Sails uses CommonJS; LaikaCMS packages are ESM-only.
// Dynamic import() bridges the gap — all ESM imports happen inside async
// initialisation in the controller, not here.

const rc = require('sails/accessible/rc');
const sails = require('sails');

sails.lift(rc('sails'), function(err) {
  if (err) {
    console.error(err);
    process.exit(1);
  }
});
