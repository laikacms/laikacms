# starter-backblaze-blog

LaikaCMS blog starter backed by **Backblaze B2 native API** (`B2StorageRepository` from
`@laikacms/backblaze/storage-b2`).

Demonstrates five wire-format traits that set the B2 native API apart from every other storage
backend in this repo:

1. **Two-phase upload** — `b2_get_upload_url` first, then POST to that URL with a per-upload
   authorization token (not the account token).
2. **File versioning by default** — every write creates a new version; deletes need the
   `(fileName, fileId)` pair, not just the path.
3. **Mandatory SHA-1** — every upload must include `X-Bz-Content-Sha1`; Backblaze rejects mismatches
   at the storage layer. The data source computes this via Web Crypto before every upload.
4. **Bare `Authorization` header** — no `Bearer` or `Basic` prefix; just the token.
5. **POST-for-everything** — even `b2_list_file_names` (a read) uses `POST` with a JSON body.

## Quick start

```bash
cp .env.example .env
# fill in your Backblaze B2 credentials
pnpm dev
```

Open `http://localhost:3000/admin` → write your first post → visit `http://localhost:3000/posts` to
confirm it's persisted in B2.

## Environment variables

| Variable             | Required | Description                                           |
| -------------------- | -------- | ----------------------------------------------------- |
| `B2_KEY_ID`          | ✅       | Application key ID (visible once at key creation)     |
| `B2_APPLICATION_KEY` | ✅       | Application key secret                                |
| `B2_BUCKET_ID`       | ✅       | 10-char bucket ID from B2 dashboard                   |
| `B2_BUCKET_NAME`     | ✅       | Human-readable bucket name (needed for download URLs) |
| `B2_BASE_PATH`       | optional | Subfolder within bucket (default: `cms`)              |
| `PORT`               | optional | HTTP port (default: `3000`)                           |

## Provisioning a Backblaze B2 bucket

1. Create a private bucket in the B2 dashboard.
2. Create an application key scoped to that bucket with capabilities: **listFiles**, **readFiles**,
   **writeFiles**, **deleteFiles**.
3. Copy the key ID and application key immediately — the secret is shown once.

## Versioning caveat

Backblaze B2 keeps all file versions by default. Every CMS save creates a new version. Old versions
accumulate and cost storage until explicitly pruned. Add a lifecycle rule in your B2 bucket settings
to auto-delete old versions, or run periodic cleanup using `b2_list_file_versions` +
`b2_delete_file_version`.

The repository removes only the **latest** version when `removeAtoms` is called.
