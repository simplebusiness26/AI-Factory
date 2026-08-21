# AI Factory V2 — execution engine

AI Factory V2 is the execution department beneath the Operating System.

## Authority model

- Opportunity Radar observes, investigates and recommends.
- Revenue Hunter independently finds near-term revenue opportunities.
- Operating System owns priorities, approval and work-order issuance.
- AI Factory plans the minimum execution route, coordinates capabilities, verifies acceptance criteria and reports evidence.

No source system can bypass the Operating System for execution authority.

## New runtime surfaces

- `GET /api/v2/health`
- `GET /api/v2/dashboard`
- `GET /api/v2/capabilities`
- `PATCH /api/v2/capabilities/:id`
- `GET /api/v2/work-orders`
- `POST /api/v2/work-orders`
- `GET /api/v2/work-orders/:id`
- `POST /api/v2/work-orders/:id/result`
- `POST /api/v2/work-orders/:id/report`
- `/factory-v2` mobile control surface

All V2 routes except health require either the existing `AI_FACTORY_KEY` or a dedicated `FACTORY_WRITE_TOKEN`. The Operating System may reuse the existing Factory key as its `AI_FACTORY_TOKEN` during the first rollout.

## Execution data

Factory V2 creates D1 tables for:

- capability registry
- work orders
- execution runs
- execution steps
- verification criteria/results
- factory event history

Work-order IDs are idempotent: resubmitting the same ID returns the existing order instead of duplicating work.

## Capability readiness

The registry deliberately tells the truth:

- Factory Planner — ready
- Verification Core — ready
- Release Factory — limited (release/build inspection; production remains gated)
- Ghost Writer Bridge — ready
- DevCouncil — not ready for automatic machine dispatch yet
- DesignLab V3 — not ready for automatic machine dispatch yet
- Production Deployment Gate — explicit authority required

A work order that requires an unavailable capability is preserved as `blocked` with the exact reason. It is not silently rerouted to a weaker system.

## DevCouncil readiness contract

Before DevCouncil changes to `ready`, it must support:

1. versioned machine work-order ingress;
2. isolated branch/worktree execution;
3. explicit repository + objective + constraints + acceptance criteria;
4. structured progress/result callbacks;
5. test/verification evidence;
6. no automatic merge or production deployment unless the OS work order grants that authority.

## DesignLab V3 readiness contract

The current DesignLabV2 repository is treated as the precursor to DesignLab V3. V3 must support:

1. versioned machine work-order ingress;
2. functionality contract from the target repository;
3. architecture/UX/UI tournament routing as appropriate to the job;
4. implementation-ready winning output;
5. structured artifacts and evidence returned to Factory;
6. verification that design changes did not remove required functionality.

Until those contracts are real and tested, Factory V2 will show both systems as not ready.

## Conservative autonomy

Initial autonomy is Level 2: isolated execution.

Allowed by default when a connected executor supports it:

- plan;
- create isolated branches;
- run tests and verification;
- open a pull request when explicitly allowed by the work order.

Not allowed by default:

- merge;
- production deploy;
- spending;
- external/customer-facing writes.

Those permissions belong to Operating System policy, not individual executors.
