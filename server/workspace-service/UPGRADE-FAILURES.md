# Upgrade failures

Deploy the account service and its account database migration before, or together
with, the workspace service. Failed upgrades retain the workspace data version and
record the failed target version. A worker can retry only when its version differs
from the failed target and is greater than the workspace data version.

This comparison also permits a rollback: if version 3 failed while the data is at
version 1, a version 2 worker may claim the workspace. It does not mean that the
retrying worker must be newer than the failed target. Check migration compatibility
before rolling back.

Claims are bounded even if a worker crashes before reporting `upgrade-started`.
Once the processing attempt count reaches 8, an `upgrade-failed` workspace is not
claimed automatically. Fix the underlying cause and reset its attempts explicitly.
Workspaces already above that limit also need an explicit reset.

Resetting an `upgrade-failed` workspace clears its previous failure message and
target version, and allows four reported upgrade runs with delays of 1, 4 and 16
minutes. Successful completion clears the old failure metadata as well.

The workspace selector displays the failed state. The transactor connection still
reports a version mismatch as an upgrade in progress. Consequently, opening a
failed workspace directly still displays the upgrade screen at 0%. A separate
connection-status change is needed to display the terminal failure there, with
compatibility for older clients during a rolling deployment.
