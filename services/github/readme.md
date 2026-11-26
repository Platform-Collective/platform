# Tasks for Github integration

## Project management from Huly (Postponed)

1. Observe all existing/closed projects and retrieve all custom field values and store them into Huly custom fields. It could be separate set of mixins possible.
2. On update of custom fields, propagate changes to appropriate project/field.
3. Status (Huly) is more rich in compare to issue/pull request (open/closed) status of Github. But for Projects, it could be "single_select" option to be used. But github right now doesn't provide a way to manage existing fields. So we could not maintain state of status field on github project. We only create/delete it.
   Possible workarounds:

   - Map Huly Status to Project Status field, and ask user to perform manual definitions of required status values. We will map by status name if appropriate value will be found.
   - On changes in Platform Status, we should show appropriate message about requirements to manage status on Github project.
   - On changes on Github side we could add necessary status values into Huly synchronized projects.

4. A list of issue for ProjectsV2 graphql APIs missing on GitHub side.
   https://github.com/orgs/community/discussions/61457
5. Enum values could be mapped to Github single_select values, but they could be created only from Github platform to prevent API limitations.
6. Text/number fields could be created from both sides.

## Source timestamps

Set `GITHUB_PRESERVE_SOURCE_TIMESTAMPS=true` to enable source dates for issue/PR import mixins, connection
activity, field updates, reviews and review comments. Unset, `false` and other values retain the existing
timestamp policy. Imports use `createdAt`; existing-document writes re-read the stored date and use the
maximum of that date, the sync snapshot and GitHub `updatedAt` to preserve newer local edits. Imported
connection messages appear at the GitHub creation date. Missing or invalid source dates fall back to
processing time, including review-thread date conversion. Authorship stays unchanged.

Automatic review/fix todos keep processing-time creation, modification and notification dates in both
modes. Their collection counters still advance the parent PR to processing time; protecting the parent
independently of todo notification dates is deferred.

This does not repair existing data, change sync versions, reconcile out-of-order historical children,
or propagate dates through collaborator description updates. An edited import without children/todos
can remain at `createdAt`. Re-reads do not provide atomic concurrency control across services. Deletion
and thread resolution dates remain processing-time approximations when no event timestamp exists.
When enabled, webhook scheduling metadata uses source time; polling takes its maximum plus 1 ms. Replacing
a legacy processing-time maximum can replay records, while an untouched legacy row can keep the cursor ahead.
