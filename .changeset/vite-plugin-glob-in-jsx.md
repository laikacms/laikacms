---
"@laikacms/vite-plugin": patch
---

`import.meta.glob('laika:…')` now works in `.tsx`/`.jsx` modules. The glob rewrite runs as a `pre`
transform (before JSX is stripped) and located `import.meta` tokens with es-module-lexer, which
cannot parse JSX and threw — failing the whole build for any component that reached for a `laika:`
glob. When the lexer can't parse a module, the plugin now falls back to scanning a copy of the
source with strings and comments masked out, which still finds real `import.meta.glob(...)` calls
while ignoring any `laika:` occurrence inside a string or comment.
