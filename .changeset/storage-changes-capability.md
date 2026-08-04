---
"@laikacms/github": patch
"@laikacms/gitlab": patch
"@laikacms/bitbucket": patch
---

Advertise `changes: unsupportedChanges` in `getCapabilities()` to satisfy the now-required `changes`
capability on the storage `Capabilities` interface. These git-backed repositories do not expose a
push change channel, so they report the no-op channel; `subscribeChanges` remains unsupported.
