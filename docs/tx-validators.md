# Transaction validators

Server plugins can register a `serverCore.class.TxValidator` document in the code model to enforce rules before matching transactions are stored. Validators cannot produce transactions and receive deeply frozen transaction copies. Clients cannot create, update, or remove validator documents; entries outside the system model are ignored.

```ts
builder.createDoc(serverCore.class.TxValidator, core.space.Model, {
  validator: myPlugin.validator.ValidateDocuments,
  objectClass: myPlugin.class.Document,
  txMatch: { _class: core.class.TxUpdateDoc } // optional
})
```

A validator implements `TxValidatorFunc`:

```ts
export async function validateDocuments (
  txes: TxCUD<Doc>[],
  control: TxValidatorControl
): Promise<void> {
  for (const tx of txes) {
    const stored = await control.current(tx)
    if (!isAllowed(tx, stored, control.account)) {
      throw new PlatformError(new Status(Severity.ERROR, platform.status.Forbidden, {}))
    }
  }
}
```

The control object provides the acting account, hierarchy, model, and document reads. `current(tx)` returns a copy of the stored document with earlier transactions for the same object in this request already applied, or `undefined` for a new or removed document. `findAllUnfiltered` reads downstream of space-security middleware and therefore bypasses document-level read restrictions. Results are only for server-side validation and must never be returned to clients.

`objectClass` includes subclasses, also classes that are created while the server is running; they are resolved on first use and the result is re-resolved when the class hierarchy changes.

Cost per request: for a non-system account the middleware checks every changed transaction for a write to the validator class itself (a hierarchy ancestor lookup, no I/O). Matching a transaction to its validators is then a map lookup, and only the first transaction of a class does the hierarchy walk. Copies of the transactions, the control object and any queries are only created when a validator matches. With no validators registered, nothing beyond the validator-class check is done.

By default, validators run before `TxApplyIf` is unpacked. A rejection fails the complete apply batch before storage and uses a `PlatformError`; unexpected validator errors also fail closed and the client only receives a generic `InternalServerError` (details are logged on the server). System-account and derived transactions are excluded by default. A validator can opt into them with `includeSystem` and `includeDerived`.

Validators with `includeDerived` are not run before the apply is unpacked. They run after `ApplyTx`, inside its scope serialization, and see the transactions of one apply at a time (client transactions included). The all-or-nothing rejection of a whole request therefore holds only for validators without `includeDerived`; transactions of the same request that are not wrapped in an apply may already be stored when such a validator rejects.

Validators without `includeDerived` run outside any scope serialization. Two concurrent requests can both pass a check-then-write rule (for example "no duplicate") because neither sees the other's write yet. A validator author who needs such a rule to hold must either use `includeDerived`, which serializes applies that share a scope, or back the rule with a deterministic object id or a unique constraint that the storage rejects.

A missing validator resource is logged with its resource and object class and rejects that class. It does not prevent unrelated classes from being written.
