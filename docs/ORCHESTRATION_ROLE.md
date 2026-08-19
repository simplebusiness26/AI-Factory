# AI Factory role in the orchestration stack

AI Factory is the **execution engine**.

It does not own company-wide priorities or decide whether an opportunity deserves resources. Those decisions belong to the Operating System.

Factory responsibilities:

1. Receive normalized, approved work orders from the Operating System.
2. Plan the minimum execution route needed for the objective.
3. Route work to connected capabilities (engineering, DesignLab, testing, release tooling, etc.).
4. Keep work isolated by default.
5. Verify acceptance criteria.
6. Report structured results and evidence back to the Operating System.

Default authority for machine-issued work orders is conservative: branch creation and verification are allowed when supported; merge and production deployment are not.
