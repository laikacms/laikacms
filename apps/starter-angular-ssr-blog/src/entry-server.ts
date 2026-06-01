/**
 * Angular SSR entry for Vite SSR builds.
 *
 * renderApplication() from @angular/platform-server renders the Angular app
 * server-side, returning a complete HTML string. The Express server calls this
 * and splices it into the index.html shell.
 *
 * renderApplication() is the lower-level API that @angular/ssr's CommonEngine
 * wraps. Using it directly shows what a meta-framework like Analog provides.
 */
import 'zone.js/node';

import { bootstrapApplication } from '@angular/platform-browser';
import { renderApplication } from '@angular/platform-server';

import { AppComponent } from './app/app.component.js';
import { appServerConfig } from './app/app.config.server.js';

function bootstrap() {
  return bootstrapApplication(AppComponent, appServerConfig);
}

export async function render(url: string, document: string): Promise<string> {
  return renderApplication(bootstrap, { document, url });
}
