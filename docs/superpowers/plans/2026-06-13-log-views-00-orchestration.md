# Log & event views — multi-session orchestration

> **For the human orchestrator.** This is the index for a 6-session program. Each session has its own self-contained handoff file and never needs another session's chat context — it reads committed artifacts only.

**Spec:** `docs/superpowers/specs/2026-06-13-log-views-program-design.md`

## The independence rule
Sessions share **committed artifacts**, never conversation context:
1. The **spec** (program map).
2. The **frozen contract** — `web/src/logs/types.ts` + `web/src/logs/mapEvent.ts`, committed by S1. Every later session imports these; none needs to know how S1 built them.
3. The **per-session handoff file** (one per session below) — fully self-contained.

## Session DAG

```
START NOW (parallel):
  S1  Foundation        docs/.../plans/2026-06-13-log-views-S1-foundation.md   [freezes contract]
  S2  Toasts            docs/.../plans/2026-06-13-log-views-S2-toasts.md       [independent]

AFTER S1 merges (parallel):
  S3  Project feed      docs/.../plans/2026-06-13-log-views-S3-project-feed.md
  S4  Build logs        docs/.../plans/2026-06-13-log-views-S4-build-logs.md
  S5  Gateway log       docs/.../plans/2026-06-13-log-views-S5-gateway-log.md

AFTER S3 merges:
  S6  Issues            docs/.../plans/2026-06-13-log-views-S6-issues.md
```

Hard edges: **S1 → {S3,S4,S5}** (they import the frozen contract) and **S3 → S6** (it builds on S3's cross-run endpoint). S2 has no edges.

## Status of each handoff
| Session | Readiness | Why |
|---|---|---|
| S1 | **Full TDD plan** | frontend-only, all data exists |
| S2 | **Full TDD plan** | mechanical; `surfaceError` already exists |
| S3–S6 | **Brief + brainstorm-first** | each adds a new gateway seam; the backend design must be brainstormed in-session before TDD (writing fabricated TDD steps for undesigned endpoints would be a plan failure). Each brief gives goal, contract to consume, acceptance shape, and the next-step block. |

## How to run a session
Open a fresh Claude session and paste:
> Execute the plan at `docs/superpowers/plans/2026-06-13-log-views-<S?>.md`. Read the referenced spec and contract first. Use superpowers:subagent-driven-development.

Each session ends by printing a **Next step** block telling you which handoff(s) it just unblocked.
