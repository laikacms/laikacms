import { render } from '@analogjs/router/server';

import AppComponent from './app/app.component.js';
import { config } from './app/app.config.server.js';

export default render(AppComponent, config);
