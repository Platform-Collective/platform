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

`objectClass` includes subclasses. Transactions whose class has no validator cost only a map lookup. With no registered validators, requests pass directly to the next middleware without document or hierarchy lookups.

By default, validators run before `TxApplyIf` is unpacked. A rejection fails the complete apply batch before storage and uses a `PlatformError`; unexpected validator errors also fail closed. System-account and derived transactions are excluded by default. A validator can opt into them with `includeSystem` and `includeDerived`. Validators with `includeDerived` run after `ApplyTx`, inside its scope serialization, so they also preserve checks that must cover server-generated transactions.

A missing validator resource is logged with its resource and object class and rejects that class. It does not prevent unrelated classes from being written.
