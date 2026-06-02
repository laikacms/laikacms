import { mergeApplicationConfig } from '@angular/core';
import { provideServerRendering } from '@angular/platform-server';

import { appConfig } from './app.config.js';

const serverConfig = mergeApplicationConfig(appConfig, {
  providers: [provideServerRendering()],
});

export { serverConfig as appConfig };
