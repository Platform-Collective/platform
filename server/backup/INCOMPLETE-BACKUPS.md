# Incomplete backups

A canceled backup or an exhausted document-chunk retry returns an unsuccessful
result. Archiving must not delete workspace data after that result. Partial
snapshots, blob metadata and size information are retained, but `lastTxId` does
not mark the backup as complete, and incomplete domain hashes are cleared so the
next run scans them again.

Regular backup scheduling uses the later of `lastAttempt` and `lastBackup` for
the interval and ordering. The attempt is recorded before pipeline creation;
failure does not advance the last successful backup time or successful count.
Failed workspaces wait for the configured interval instead of being immediately
requeued, so a repeatedly timed-out workspace does not stay first in every cycle.
With an interval of zero, every workspace remains eligible, ordered by its last
attempt. Older backup services ignore `lastAttempt`; queue fairness requires the
updated backup service. No account database migration is required for this
optional field in the existing backup-status JSON.

Alert on repeated `BACKUP FAILED` messages and on the age of `lastBackup` rather
than treating a recent `lastAttempt` as a successful backup.

The incomplete-document counter covers document-chunk load retries in
`processDomain`. Account-domain loading, individual blob download failures and
blob size or content-type limits retain their existing behaviour, including for
archives. An unsuccessful result therefore catches these documented incomplete
paths; a successful result does not add a new completeness guarantee for those
unchanged paths.
