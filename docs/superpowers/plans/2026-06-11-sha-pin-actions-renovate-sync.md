# SHA-pin GitHub Actions + wire Renovate sync bot (DV4/DV13)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans
> to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Replace every mutable-tag `uses:` across the four workflow files with a
40-char commit-SHA pin (faithful, no version upgrade), and add Renovate to bump
those SHA pins + surface action/workflow drift as a reviewable PR — without
introducing double-PRs against the existing Dependabot.

**Architecture:** Pin-only change. Each `uses: org/action@tag` becomes
`uses: org/action@<40-char-SHA>  # tag`, where the SHA is exactly the commit the
tag points at *today* (resolved via `gh api repos/<o>/<r>/commits/<tag>`), so CI
is behavior-identical. Renovate (`renovate.json`) takes ownership of the
`github-actions` manager — pinning + bumping digests — and the `github-actions`
ecosystem is removed from `dependabot.yml` so the two bots never both open an
action PR. Dependabot keeps npm + cargo. Heavier cross-repo file-sync
(`repo-file-sync-action`, needs a cross-repo PAT and a source-of-truth repo) is
intentionally NOT added — it would expand secret/attack surface; Renovate's
repo-wide `pinDigests` is the sync mechanism (any newly-introduced unpinned
action → pin PR).

**Tech Stack:** GitHub Actions YAML, Renovate (`renovate.json`), Dependabot.

---

## Resolved SHA map (faithful — tag → commit it points at on 2026-06-11)

| Action (original)                     | Pin SHA                                    | Comment | = version            |
|---------------------------------------|--------------------------------------------|---------|----------------------|
| `actions/checkout@v6`                 | `df4cb1c069e1874edd31b4311f1884172cec0e10` | `# v6`  | v6.0.3               |
| `dorny/paths-filter@v4`               | `fbd0ab8f3e69293af611ebaee6363fc25e6d187d` | `# v4`  | v4.0.1               |
| `dtolnay/rust-toolchain@stable`       | `29eef336d9b2848a0b548edc03f92a220660cdb8` | `# stable` | stable branch HEAD |
| `Swatinem/rust-cache@v2`              | `e18b497796c12c097a38f9edb9d0641fb99eee32` | `# v2`  | v2                   |
| `pnpm/action-setup@v6`                | `0e279bb959325dab635dd2c09392533439d90093` | `# v6`  | v6.0.8               |
| `actions/setup-node@v6`               | `48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e` | `# v6`  | v6.4.0               |
| `actions/upload-artifact@v7`          | `043fb46d1a93c77aae656e7c1c64a875d1fc6a0a` | `# v7`  | v7.0.1               |
| `taiki-e/install-action@v2`           | `7a79fe8c3a13344501c80d99cae481c1c9085912` | `# v2`  | v2.81.10             |
| `anthropics/claude-code-action@beta`  | `28f83620103c48a57093dcc2837eec89e036bb9f` | `# beta`| beta branch HEAD     |

Comment is the **original tag** (per brief: `uses: org/action@<SHA>  # tag`), which
is what Renovate/Dependabot track to know what to bump to.

---

### Task 1: SHA-pin `ci.yml`

**Files:** Modify `.github/workflows/ci.yml`

`uses:` occurrences to replace (all of them): `actions/checkout@v6` (×4),
`dorny/paths-filter@v4` (×1), `dtolnay/rust-toolchain@stable` (×2),
`Swatinem/rust-cache@v2` (×2), `pnpm/action-setup@v6` (×2),
`actions/setup-node@v6` (×2), `actions/upload-artifact@v7` (×1).

- [ ] **Step 1:** Replace each with `org/action@<SHA>  # tag` from the map above.
      Two-space gap before `#` to match tau's convention. No other edits.
- [ ] **Step 2:** Verify no bare tag remains in this file.

Run: `grep -nE 'uses: [^ ]+@(v[0-9]+|stable|beta|main)([ #]|$)' .github/workflows/ci.yml`
Expected: no output (every third-party `uses:` is a SHA; local `./.github` composites, if any, are exempt).

### Task 2: SHA-pin `coverage.yml`

**Files:** Modify `.github/workflows/coverage.yml`

Replace: `actions/checkout@v6`, `dtolnay/rust-toolchain@stable`,
`Swatinem/rust-cache@v2`, `taiki-e/install-action@v2`, `actions/upload-artifact@v7`.

- [ ] **Step 1:** Apply pins from the map.
- [ ] **Step 2:** `grep -nE 'uses: [^ ]+@(v[0-9]+|stable|beta)' .github/workflows/coverage.yml` → no output.

### Task 3: SHA-pin `claude.yml`

**Files:** Modify `.github/workflows/claude.yml`

Replace: `actions/checkout@v6`, `anthropics/claude-code-action@beta` (the sharpest
edge — `@beta` is a moving branch on a security-sensitive action).

- [ ] **Step 1:** Apply pins. Leave the actor allowlist `if:` gate and
      least-privilege `permissions:` UNCHANGED.
- [ ] **Step 2:** `grep -nE '@beta|@v6' .github/workflows/claude.yml` → no output.

### Task 4: SHA-pin `claude-review.yml`

**Files:** Modify `.github/workflows/claude-review.yml`

Replace: `actions/checkout@v6`, `anthropics/claude-code-action@beta`.

- [ ] **Step 1:** Apply pins. Leave `pull_request` trigger (not
      `pull_request_target`), `vars.CLAUDE_REVIEW_ENABLED` gate,
      `allowed_bots`/`direct_prompt`, and `permissions:` UNCHANGED.
- [ ] **Step 2:** `grep -nE '@beta|@v6' .github/workflows/claude-review.yml` → no output.

### Task 5: Add `renovate.json`

**Files:** Create `renovate.json`

- [ ] **Step 1:** Config:
  - `extends`: `config:recommended` + `helpers:pinGitHubActionDigests`.
  - `enabledManagers: ["github-actions"]` — Renovate owns ONLY actions (npm/cargo
    stay on Dependabot → no double-PRs).
  - `github-actions.pinDigests: true` — any unpinned action that lands later
    (e.g. from a sibling-synced job) becomes a pin PR = drift surfaces as a PR.
  - Group action digests into one weekly PR; sensible labels/`prConcurrentLimit`.
- [ ] **Step 2:** Validate: `npx --yes --package renovate -- renovate-config-validator renovate.json`
      Expected: `Config validated successfully`.

### Task 6: Remove `github-actions` from `dependabot.yml`

**Files:** Modify `.github/dependabot.yml`

- [ ] **Step 1:** Delete the `github-actions` update block (lines for
      `package-ecosystem: github-actions`). Keep `npm` (`/web`) and `cargo` (`/`)
      blocks exactly as-is. This is what prevents Dependabot + Renovate both
      opening action-bump PRs.
- [ ] **Step 2:** `grep -n github-actions .github/dependabot.yml` → no output.

### Task 7: Whole-repo verification

- [ ] **Step 1:** Prove no bare tag/branch ref survives in any workflow:

Run: `grep -rnE 'uses: [^ ]+@(v[0-9]+|stable|beta|main|master)([ #]|$)' .github/workflows/`
Expected: no output.

- [ ] **Step 2:** Prove every third-party `uses:` is now a 40-hex SHA:

Run: `grep -rhoE 'uses: [^ ]+@[0-9a-f]{40}' .github/workflows/ | sort | uniq -c`
Expected: every external action listed, each with a 40-char SHA.

- [ ] **Step 3:** Re-confirm each pinned SHA still equals what the tag points at
      (no silent drift in my resolution): re-run `gh api repos/<o>/<r>/commits/<tag>`
      for all nine and diff against the map. Capture output.

- [ ] **Step 4:** Commit, push, open PR (`gh pr create -R tau-rs/tau-web-ui --base main`),
      confirm the full CI run resolves & runs every SHA-pinned action green —
      capture the real run. Cite DV4/DV13. STOP — no merge.

---

## Self-review notes
- **Spec coverage:** DV4 (pin all `uses:`) → Tasks 1–4 + Task 7 gates.
  DV13 (Renovate + sync template) → Tasks 5–6. ✅
- **Security posture (do-not-regress):** Tasks 3–4 explicitly leave actor
  allowlist, `pull_request` (not `_target`), and least-privilege `permissions`
  untouched. No new secrets/PATs introduced (repo-file-sync deliberately skipped). ✅
- **No upgrades:** every SHA = current tag target (faithful), proven in Task 7.3. ✅
- **Phase-2 deferred:** projen generator + synth-diff NOT in scope. ✅
