# @laikacms/aws

AWS service implementations for [Laika CMS](https://www.npmjs.com/package/laikacms).

```bash
pnpm add @laikacms/aws
```

## Exports

### `@laikacms/aws/contentbase-settings-ddb`

DynamoDB-backed `SettingsProvider` for contentbase settings.

```ts
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDbSettingsProvider } from '@laikacms/aws/contentbase-settings-ddb';

const settings = new DynamoDbSettingsProvider({
  client: new DynamoDBClient({ region: 'eu-west-1' }),
  tableName: 'laikacms-settings',
});
```

Pair with `laikacms/contentbase-api` to serve settings over JSON:API.

## Companion packages

- [`laikacms`](https://www.npmjs.com/package/laikacms) — core domain, APIs, serializers
- [`@laikacms/github`](https://www.npmjs.com/package/@laikacms/github) — GitHub storage
- [`@laikacms/decap`](https://www.npmjs.com/package/@laikacms/decap) — Decap CMS integrations

## Documentation

See the [laikacms repository](https://github.com/laikacms/laikacms) for full docs.

## License

MIT
