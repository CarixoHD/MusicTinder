# 0007. Deck mixes seed branches and deals occasional wildcard cards (exploration)

Date: 2026-11-21 · Status: Accepted

## Context

Owner: discovery only deals electronic although The Weeknd is a seed; wants more genre mix and some cards outside what they asked for. Cause from the code: rank() in src/taste/taste.ts sorts the pool purely by score. Several electronic seeds stack the same chip (+β each), and the popularity dampener pushes The Weeknd's Deezer related artists (Rihanna, SZA, Drake, Miguel… checked live: all very famous) below the small synthwave acts. So the electronic branch always ranks first, and each like makes it stronger. Pure exploitation, no diversity and no exploration.

## Options considered

- **Keep pure score ranking, tune β/dampener**: Cheap, but one dominant genre still wins every slot; doesn't give 'something I wasn't looking for'.
- **Seed-balanced re-rank + wildcard slot**: After scoring, interleave so no seed branch / dominant chip takes more than a few cards in a row and every seed branch with candidates surfaces in each window. In addition, about 1 in 6 cards is a labelled wildcard drawn from outside the dominant chips. Taste still orders each branch.
- **Full MMR / bandit**: More principled diversity, but heavier to tune and test for a client-side MVP.

## Decision

Seed-balanced re-rank + a wildcard slot. Diversity: within any window of 5 dealt cards, at most 3 share the same top chip, and every seed branch that has candidates appears at least once per ~6 cards. Exploration: about every 6th card is a 'wildcard', an unseen candidate whose chips are outside the current top taste chips (from the least-represented seed branch, or from a genre search on a curated chip the listener hasn't picked). It is labelled 'Something different' instead of 'because you like X', and skipping it lowers its chips only half as much as a normal skip.

## Rationale

This is a standard recommender fix: re-rank for diversity after relevance scoring, and add a small exploration share so one taste doesn't take over. It keeps the PRD's 'likes visibly lean the deck' rule, because relevance still orders cards within each branch. It is testable with ranking-rule assertions and adds no network work on the commit path.
