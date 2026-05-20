---
"@laikacms/aws": minor
---

New subpath export `@laikacms/aws/storage-ddb` — a DynamoDB-backed
`StorageRepository`. Single-table design: each row is one file or folder
marker, `PK = "STORAGE#<parentKey>"`, `SK = "<basename>"`. Listing a folder
is a single `Query` against the parent partition; finding an extension-free
key is one `Query` with `begins_with(SK, "<base>.")` plus a client-side
filter to the registered serializer extensions. `partitionPrefix` is
configurable for multi-tenant deployments. `@aws-sdk/lib-dynamodb` is an
optional peer (already listed). Knocks "DynamoDB implementation" off the
roadmap.
