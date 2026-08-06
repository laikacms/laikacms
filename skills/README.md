# laikacms agent skills

Installable [agent skills](https://skills.sh) for working with laikacms. They run in Claude Code,
Codex, Cursor, and other agents that support the SKILL.md format.

## Install

```bash
# install every laikacms skill
npx skills add laikacms/laikacms

# or pick one
npx skills add laikacms/laikacms --skill laikacms-docs

# list what's available first
npx skills add laikacms/laikacms --list
```

Skills install into your agent's skill directory (e.g. `.claude/skills/`) and are picked up
automatically.

## Available skills

| Skill                                                                | What it does                                                                                                                                                                                                                                                                                        |
| -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`laikacms-docs`](./laikacms-docs)                                   | Finds and reads the laikacms documentation matching the exact version installed in your project — so the agent answers from version-accurate docs instead of memory.                                                                                                                                |
| [`decap-oauth2-adversarial-probe`](./decap-oauth2-adversarial-probe) | Red-teams the `decap-oauth2` authorization server against an adversary holding an unbounded botnet and a quantum computer. Fixes what is fixable and installs blocking runtime safety gates for what is not. Needs a checkout of the package source, and runs best on the strongest model you have. |
