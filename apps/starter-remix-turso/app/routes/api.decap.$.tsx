import type { ActionFunctionArgs, LoaderFunctionArgs } from '@remix-run/node';

import { laika } from '~/lib/laika.server';

export function loader({ request }: LoaderFunctionArgs) {
  return laika.fetch(request);
}

export function action({ request }: ActionFunctionArgs) {
  return laika.fetch(request);
}
