# 0008. Story 14 (sync across devices) ships first as file export/import, with no backend

Date: 2026-11-22 · Status: Accepted

## Context

Story 14 asks for taste to sync across devices. ADR-001/003 chose a no-backend, no-account static PWA with localStorage only. Real automatic sync needs somewhere to keep the data between devices.

## Options considered

- **File export/import (no server)**: Settings → Export writes one JSON file (Web Share on phones, download elsewhere); Import on the other device validates it with the store's existing repair path and merges it. No account, no hosting, works offline. Manual: one transfer per move.
- **Anonymous sync code via a tiny Cloudflare Worker + KV**: A random code identifies a blob in Workers KV; devices push/pull on change. Automatic, still no account, but adds a backend to deploy, run and pay for (free tier likely enough), plus privacy and abuse questions.
- **Third-party storage (Google Drive / iCloud / remoteStorage)**: Sync through a provider the listener already has. Needs OAuth and an account, which the PRD deliberately avoids.

## Decision

Build file export/import now (M7). Ask the owner whether automatic sync through a small Worker is wanted; if yes, it builds on the same snapshot/merge code.

## Rationale

Keeps ADR-003's no-backend, no-account promise and costs nothing to run. The snapshot + merge function is exactly what an automatic sync would need too, so nothing is thrown away. A backend is a money/hosting choice only the owner can make. Merge rule: likes, seen and seeds are unioned by key; taste weights are averaged per feature (a feature on one side only keeps its value); settings stay local to each device.
