---
"laikacms": patch
---

`assets-api` `GET /resources` no longer surfaces a `not_found` recoverable error as a
`meta.warnings` entry when the listed folder does not exist. A missing media folder is the normal
first-run state for a fresh deployment; clients now receive a clean `200` with `data: []` and no
console noise (LCMS-1009).
