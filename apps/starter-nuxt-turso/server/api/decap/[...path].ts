import { toWebRequest } from 'h3';

import { laika } from '../../utils/laika';

export default defineEventHandler(event => laika.fetch(toWebRequest(event)));
