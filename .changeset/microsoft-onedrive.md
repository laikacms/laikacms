---
"@laikacms/microsoft": minor
---

New package: `@laikacms/microsoft`. First export `@laikacms/microsoft/storage-onedrive` — a
`StorageRepository` over OneDrive (personal & for-Business) or a SharePoint document library via the
Microsoft Graph API. Three architectural traits distinguish it from the rest of the suite: (1)
**native path addressing** via the `/me/drive/root:/path:` colon-segment URL syntax (no opaque-id
lookup step); (2) **`POST /$batch` as the bulk endpoint** — up to 20 mixed-method requests in one
HTTP round-trip with optional `dependsOn` sequencing, the **9th structurally distinct
atomic-multi-write mechanism in the suite**; (3) **pre-signed `@microsoft.graph.downloadUrl`** in
metadata, so reads skip a second authenticated round-trip. `conflictBehavior` is configured
per-write (`fail` / `replace` / `rename`) — the first backend with per-write conflict policy at the
API level. Runtime-agnostic — only depends on `fetch`.
