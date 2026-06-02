import 'reflect-metadata';

import { controller, IAppController } from '@foal/core';

import { AdminController } from './admin.controller.js';
import { BlogController } from './blog.controller.js';

export class AppController implements IAppController {
  subControllers = [
    controller('/', BlogController),
    controller('/admin', AdminController),
  ];
}
