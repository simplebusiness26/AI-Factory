# AI Factory

AI Factory is the **execution engine** for the products, agents and workflows in the `simplebusiness26` GitHub account.

The **Operating System is the authority layer**: it owns priorities, approvals, project state and work-order issuance. Opportunity Radar supplies intelligence and recommendations. AI Factory receives approved work orders, plans the execution route, coordinates the required capabilities, verifies the result and reports evidence back to the Operating System.

The existing Mission Control, Project Brain, Watchtower, Release Factory, Today, Decision Engine, Knowledge Mine and Ghost Writer bridge remain useful Factory surfaces, but they do not override the Operating System's authority.

## Orchestration flow

`Opportunity Radar -> Operating System -> AI Factory -> Operating System -> Opportunity Radar`

Machine-issued work orders are deliberately conservative by default:

- isolated branch work may be allowed;
- pull requests may be allowed;
- automatic merges are not allowed;
- automatic production deployment is not allowed.

See `docs/ORCHESTRATION_ROLE.md` for the execution boundary.

Development happens on feature branches and is merged into `main` after validation.
