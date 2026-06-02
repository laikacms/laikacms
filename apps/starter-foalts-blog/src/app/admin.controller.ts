import { Get, HttpResponseOK } from '@foal/core';

import { ADMIN_HTML } from './laika.js';

export class AdminController {
  @Get('/')
  @Get('')
  index() {
    const res = new HttpResponseOK(ADMIN_HTML);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res;
  }
}
