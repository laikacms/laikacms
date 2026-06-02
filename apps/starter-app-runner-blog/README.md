# starter-app-runner-blog

Blog deployable to [AWS App Runner](https://aws.amazon.com/apprunner/) — a fully managed container
service that auto-scales to zero. No EC2 instances, no Docker push required; App Runner builds from
your GitHub repo using `apprunner.yaml`.

## Quick start (local)

```bash
pnpm install
pnpm dev
```

Open <http://localhost:3000> for the blog, <http://localhost:3000/admin> for the CMS editor.

## Deploy to AWS App Runner

1. Push this repo to GitHub.
2. [AWS Console](https://console.aws.amazon.com/apprunner) → **Create service** → **Source:
   Repository**.
3. Select your repo and branch. Under **Configuration file**, choose **Use a configuration file**.
4. App Runner reads `apprunner.yaml`, installs `pnpm`, and starts `tsx src/server.ts`.

### Persistent content

App Runner has **no built-in persistent storage**. Content written to the local filesystem is lost
when the instance recycles or a new version deploys.

For durable content use one of the LaikaCMS cloud storage adapters:

| Adapter                   | When to use                              |
| ------------------------- | ---------------------------------------- |
| `@laikacms/s3`            | Natural fit — App Runner runs inside AWS |
| `@laikacms/github`        | Git-backed content, zero infra           |
| `@laikacms/cloudflare-r2` | Lower egress cost than S3                |

### `apprunner.yaml`

```yaml
version: 1.0
runtime: nodejs22

build:
  commands:
    pre-build:
      - npm install --global pnpm
    build:
      - pnpm install --frozen-lockfile

run:
  command: pnpm --filter @laikacms/starter-app-runner-blog start
  network:
    port: 8080
    env: PORT
```

App Runner's managed runtime means no Dockerfile — the YAML selects the Node.js version, build
commands, and start command. Environment variables (including `CONTENT_DIR` for a custom mount path)
are set in the App Runner service configuration in the AWS console.

## Health check

App Runner polls `/health` to determine service health. The route returns `{ "status": "ok" }` and
is the recommended path for App Runner's healthcheck setting.

## Doc gap surfaced

**Ephemeral filesystem warning** — App Runner, Cloud Run, and similar managed runtimes recycle
containers without warning, losing any content written to the local filesystem. This starter's
README and inline comments make the limitation explicit and link to storage adapters. Most other
LaikaCMS starters omit this warning.
