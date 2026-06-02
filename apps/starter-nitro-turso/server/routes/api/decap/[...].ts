import { defineEventHandler, toWebRequest } from 'h3';

import { laika } from '../../../utils/laika.js';

export default defineEventHandler(event => laika.fetch(toWebRequest(event)));
