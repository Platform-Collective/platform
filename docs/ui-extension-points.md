# UI extension points

Third-party modules and downstream forks can add Svelte components to selected UI locations without changing the host plugin. Register a `presentation.class.ComponentPointExtension` in the module model, using the location's `ComponentExtensionId` and a component exposed by the module:

```ts
builder.createDoc(presentation.class.ComponentPointExtension, core.space.Model, {
  extension: tracker.extensions.EditIssueActions,
  component: myModule.component.MyIssueAction
})
```

The host renders registered components with `ComponentExtensions`. Extension-specific `props` declared on the model document are merged with the runtime props below. Registrations are model documents and become available through the normal model deployment and workspace upgrade cycle.

The extension points themselves add no production UI components. The model tests register `test.component.*` components to cover third-party registration without changing the visible application.

## Comment input

Use `chunter.extensions.ChatMessageInput` to add options below the comment editor in `ChatMessageInput.svelte`, for example a draft-size indicator or a module-specific composing option.

Runtime props:

- `object`: the document or parent activity message being commented on.
- `content`: the current editor markup.
- `chatMessage`: the message being edited, or `undefined` for a new message.
- `withTypingInfo`: whether typing presence is enabled for this input.
- `onMessageCreated`: registers a callback and returns its unregister function. After a new message is committed, each callback receives a `ChatMessageCreatedEvent` with the message ID, class, space, target object, markup and attachment count. No additional document lookup is performed. Import `RegisterChatMessageCreatedHandler` and `ChatMessageCreatedHandler` from `@hcengineering/chunter` for the callback types. Unregister the callback when the component is destroyed. Callback errors are reported independently and do not change the result of sending the message.

A third-party draft-size indicator could be as small as:

```svelte
<script lang="ts">
  import { type Markup } from '@hcengineering/core'
  import { markupToText } from '@hcengineering/text'

  export let content: Markup
  $: count = markupToText(content).length
</script>

<div>{count} characters</div>
```

## Issue actions

Use `tracker.extensions.EditIssueActions` to add an action to the issue detail header in `EditIssue.svelte`, for example a link to a related system or a module-specific export action. Actions are rendered with the existing header controls when the issue is editable.

Runtime props:

- `object` and `value`: the current `Issue`.
- `_class`: the issue class.
- `space`: the issue's project.
- `readonly`: the effective read-only state.
