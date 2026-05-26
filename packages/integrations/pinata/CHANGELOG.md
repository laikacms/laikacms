# @laikacms/pinata

## 1.0.0

### Minor Changes

- Initial release. Pinata (IPFS)-backed `StorageRepository`. First **content-addressed** backend in
  the suite — CIDs are content hashes, so updates are copy-on-write: pin new content, then unpin
  old. The mutable storage contract sits on top of Pinata's pin-metadata search. Runtime-agnostic —
  only depends on `fetch`.
