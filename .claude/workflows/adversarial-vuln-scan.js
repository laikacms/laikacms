export const meta = {
  name: 'adversarial-vuln-scan',
  description:
    'Adversarially scan a push diff for vulnerabilities — the change itself and the regressions it causes at dependent call sites. Never audits the whole codebase.',
  phases: [
    { title: 'Scope', detail: 'enumerate changed files and hunks from the push diff' },
    { title: 'Blast radius', detail: 'per changed file, find the dependents a change could regress' },
    { title: 'Hunt', detail: 'adversarial finders inspect the diff and its dependents' },
    { title: 'Verify', detail: 'independent skeptics confirm or refute each finding' },
    { title: 'Report', detail: 'synthesize the confirmed vulnerabilities' },
  ],
}

// ---------------------------------------------------------------------------
// The guiding principle, repeated to every agent: the committed codebase is
// assumed safe. We are only interested in what THIS change introduces —
// either directly in the diff, or by regressing code (Y) that depended on the
// old behaviour of what changed (X). Pre-existing issues unrelated to the
// change are explicitly out of scope.
// ---------------------------------------------------------------------------
const PRINCIPLE = [
  'GROUND RULES (do not violate):',
  '- Treat the existing/committed codebase as already reviewed and safe. Do NOT hunt for pre-existing vulnerabilities.',
  '- Report a finding ONLY if this change is responsible for it: the vulnerability is introduced in the diff, OR the diff changes the behaviour/contract of a symbol (X) in a way that breaks a security assumption at a caller or dependent (Y).',
  '- A regression at Y counts even when Y is not in the diff — that is the point of this scan. But you must be able to name the specific changed symbol X and the specific dependent Y and explain the causal link.',
  '- Do NOT flag style, lint, or generic hardening ideas. Only concrete security defects (injection, authz/authn bypass, SSRF, path traversal, secret exposure, unsafe deserialization, prototype pollution, ReDoS, missing validation on a newly-trusted input, broken invariant a dependent relied on, etc.).',
].join('\n')

const CHANGED_FILES_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['range', 'files', 'dropped'],
  properties: {
    range: { type: 'string', description: 'the git revision range that was diffed, e.g. abc123..def456' },
    dropped: {
      type: 'integer',
      description: 'how many changed files were excluded from `files` because the list was capped',
    },
    files: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['path', 'summary', 'changedSymbols', 'securityRelevant'],
        properties: {
          path: { type: 'string' },
          summary: { type: 'string', description: 'one line: what changed in this file' },
          changedSymbols: {
            type: 'array',
            description: 'exported/public functions, classes, types, routes, or config keys this diff altered',
            items: { type: 'string' },
          },
          securityRelevant: {
            type: 'boolean',
            description: 'true if the change touches auth, input handling, file/network/db access, crypto, serialization, or config',
          },
        },
      },
    },
  },
}

const BLAST_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['path', 'dependents'],
  properties: {
    path: { type: 'string' },
    dependents: {
      type: 'array',
      description: 'places that consume the changed symbols and could regress',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['location', 'symbol', 'why'],
        properties: {
          location: { type: 'string', description: 'file:line of the dependent (Y)' },
          symbol: { type: 'string', description: 'the changed symbol (X) it depends on' },
          why: { type: 'string', description: 'what assumption about X this dependent relies on' },
        },
      },
    },
  },
}

const FINDINGS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['findings'],
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'severity', 'changedSymbol', 'affectedLocation', 'mechanism', 'attackScenario'],
        properties: {
          title: { type: 'string' },
          severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
          changedSymbol: { type: 'string', description: 'X — the changed symbol responsible' },
          affectedLocation: { type: 'string', description: 'file:line where the vulnerability manifests (may be a dependent Y)' },
          mechanism: { type: 'string', description: 'how the change creates the vulnerability' },
          attackScenario: { type: 'string', description: 'concrete inputs/state that trigger it and the impact' },
        },
      },
    },
  },
}

const VERDICT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['refuted', 'reason'],
  properties: {
    refuted: { type: 'boolean', description: 'true if this finding is NOT a real, change-introduced vulnerability' },
    reason: { type: 'string' },
  },
}

// The diff range is passed in by the GitHub Action via env vars; the scout
// resolves it robustly and falls back to the last commit if they are absent.
phase('Scope')
const scope = await agent(
  [
    'You are scoping an adversarial security review of a single push. Determine the diff range and enumerate what changed.',
    '',
    'Resolve the revision range in this order:',
    '1. If env vars BASE_SHA and HEAD_SHA are set, BASE_SHA is not all-zeros, and `git cat-file -e "$BASE_SHA^{commit}"` succeeds, use "$BASE_SHA".."$HEAD_SHA".',
    '2. Otherwise fall back to HEAD~1..HEAD.',
    'Run `git --no-pager diff --stat <range>` and `git --no-pager diff <range>` to see the change. Read full files with Read when a hunk lacks context.',
    '',
    'For every changed file, record a one-line summary, the exported/public symbols the diff altered (functions, classes, types, HTTP routes, config keys), and whether it is security-relevant.',
    'Ignore pure test fixtures, lockfiles, generated files, docs, and formatting-only changes — set them aside, do not list them.',
    'If more than 25 substantive files changed, keep the 25 most security-relevant and set `dropped` to the count you excluded.',
    '',
    PRINCIPLE,
  ].join('\n'),
  { label: 'scout:diff', phase: 'Scope', schema: CHANGED_FILES_SCHEMA },
)

if (!scope || !scope.files || scope.files.length === 0) {
  log('No substantive changed files found in the push diff — nothing to scan.')
  return { range: scope ? scope.range : 'unknown', confirmed: [], note: 'no substantive changes' }
}

log(`Scoped ${scope.files.length} changed file(s) over ${scope.range}${scope.dropped ? `; ${scope.dropped} excluded by cap` : ''}`)

// Pipeline: each changed file flows through blast-radius mapping, then an
// adversarial hunt over the diff + its dependents. Files run independently —
// a later file's hunt starts as soon as its own blast-radius maps, no barrier.
const perFile = await pipeline(
  scope.files,
  // Stage 1 — map the blast radius (X -> Y).
  (file) =>
    agent(
      [
        `Map the blast radius of the change to \`${file.path}\`.`,
        `What changed: ${file.summary}`,
        `Changed symbols (X): ${file.changedSymbols.join(', ') || '(none named — infer from the diff)'}`,
        '',
        'Use grep/glob across the repo to find every place that imports or calls these symbols (the dependents Y). For each dependent, note the specific assumption it makes about X (return shape, validation it expects X to have already done, error behaviour, auth/trust boundary, etc.).',
        'Focus on dependents where a behavioural change in X could weaken a security property. Skip dependents that only use X in trivial, non-security ways.',
        '',
        PRINCIPLE,
      ].join('\n'),
      { label: `blast:${file.path}`, phase: 'Blast radius', schema: BLAST_SCHEMA },
    ),
  // Stage 2 — adversarial hunt over the diff and the mapped dependents.
  (blast, file) =>
    agent(
      [
        `Adversarially hunt for vulnerabilities that the change to \`${file.path}\` introduces.`,
        `What changed: ${file.summary}`,
        '',
        'Inspect two surfaces:',
        `1. The diff of ${file.path} itself (re-read it with git diff).`,
        '2. The dependents identified as its blast radius:',
        blast && blast.dependents && blast.dependents.length
          ? blast.dependents.map((d) => `   - ${d.location} uses ${d.symbol}: relies on "${d.why}"`).join('\n')
          : '   - (no significant dependents were identified)',
        '',
        'For each dependent, ask: does the new behaviour of X break the security assumption Y made about it? Then hunt the diff directly for newly-introduced defects.',
        'Be adversarial and specific. Every finding must name the changed symbol X and a concrete attack scenario. If you find nothing real, return an empty findings array — do not invent findings to look thorough.',
        '',
        PRINCIPLE,
      ].join('\n'),
      { label: `hunt:${file.path}`, phase: 'Hunt', schema: FINDINGS_SCHEMA },
    ),
)

// Flatten findings, tagging each with the file it came from for traceability.
const rawFindings = []
perFile.filter(Boolean).forEach((result, i) => {
  const file = scope.files[i]
  ;(result.findings || []).forEach((f) => rawFindings.push({ ...f, file: file.path }))
})

if (rawFindings.length === 0) {
  log('Hunt found no candidate vulnerabilities in the change.')
  return { range: scope.range, confirmed: [], note: 'clean — no candidate findings' }
}

log(`Hunt surfaced ${rawFindings.length} candidate finding(s); verifying adversarially.`)

// Verify: two independent skeptics per finding, each prompted to REFUTE. A
// finding survives only if neither skeptic can refute it. Distinct lenses so
// they catch different failure modes.
phase('Verify')
const LENSES = [
  'Introduced-by-this-change: try to prove this defect already existed before the change, or that the change does NOT actually cause it. If it is pre-existing or unrelated to the diff, it is refuted.',
  'Exploitability: try to prove the attack scenario cannot actually be reached or triggered (unreachable path, prior validation, framework guarantee, type constraint). If it cannot be triggered, it is refuted.',
]

const verified = await parallel(
  rawFindings.map((finding) => async () => {
    const votes = await parallel(
      LENSES.map((lens, li) => () =>
        agent(
          [
            'Adversarially verify a reported vulnerability. Your job is to REFUTE it. Default to refuted=true unless the evidence is clear.',
            '',
            `Finding: ${finding.title} (severity: ${finding.severity})`,
            `Changed symbol (X): ${finding.changedSymbol}`,
            `Manifests at: ${finding.affectedLocation}`,
            `Mechanism: ${finding.mechanism}`,
            `Attack scenario: ${finding.attackScenario}`,
            `File under review: ${finding.file}`,
            '',
            `Verification lens — ${lens}`,
            'Read the actual code and diff to decide. Do not take the finding at face value.',
            '',
            PRINCIPLE,
          ].join('\n'),
          { label: `verify:${finding.file}#${li}`, phase: 'Verify', schema: VERDICT_SCHEMA },
        ),
      ),
    )
    const alive = votes.filter(Boolean)
    const survives = alive.length > 0 && alive.every((v) => !v.refuted)
    return survives ? { ...finding, verdicts: alive } : null
  }),
)

const confirmed = verified.filter(Boolean)
const order = { critical: 0, high: 1, medium: 2, low: 3 }
confirmed.sort((a, b) => (order[a.severity] ?? 9) - (order[b.severity] ?? 9))

phase('Report')
log(`Confirmed ${confirmed.length} of ${rawFindings.length} candidate finding(s).`)

return {
  range: scope.range,
  filesScanned: scope.files.length,
  filesDroppedByCap: scope.dropped || 0,
  candidateCount: rawFindings.length,
  confirmed: confirmed.map((f) => ({
    title: f.title,
    severity: f.severity,
    file: f.file,
    changedSymbol: f.changedSymbol,
    affectedLocation: f.affectedLocation,
    mechanism: f.mechanism,
    attackScenario: f.attackScenario,
  })),
}
