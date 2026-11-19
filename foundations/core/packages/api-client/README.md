# Huly Platform API Client

A TypeScript client library for interacting with the Huly Platform API.

## Installation

In order to be able to install required packages, you will need to obtain GitHub access token. You can create a token by following the instructions [here](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-npm-registry#authenticating-with-a-personal-access-token).

```bash
npm install @hcengineering/api-client
```

## Examples and your own instance

The [huly-examples repository](https://github.com/hcengineering/huly-examples) contains runnable examples for [listing issues](https://github.com/hcengineering/huly-examples/blob/main/platform-api/examples/issue-list.ts), creating and updating issues, and [listing documents](https://github.com/hcengineering/huly-examples/blob/main/platform-api/examples/documents/document-list.ts). Follow its installation instructions and use package versions compatible with your server.

For your own instance, pass the URL you use to open Huly, such as `https://huly.example.com`, to `connect` or `connectRest`. For Huly Cloud, use `https://huly.app`. The client loads `/config.json` from this URL to discover the services; do not pass a WebSocket endpoint or the full workspace URL.

For example, if your workspace URL is `https://huly.example.com/workbench/my-workspace`, use `https://huly.example.com` as the instance URL and `my-workspace` as the `workspace` option. The machine running the client must be able to reach the instance and the services advertised in its configuration.

The examples below use a placeholder instance URL. Replace it with your own URL and workspace. Keep credentials outside source code, for example in environment variables. A GitHub package-registry token is separate from a Huly authentication token.

## WebSocket Client vs REST Client

The api client package provides two main client variants: a WebSocket client and a REST client. The WebSocket client holds persistent connection to the Huly Platform API. The REST client uses standard HTTP requests to perform operations.

### WebSocket Client

```ts
import { connect } from '@hcengineering/api-client'

// Connect to Huly
const client = await connect('https://huly.example.com', {
  email: 'johndoe@example.com',
  password: 'password',
  workspace: 'my-workspace',
})

// Use the client to perform operations
...

// Close the client when done
await client.close()
```

### REST Client

```ts
import { connectRest } from '@hcengineering/api-client'

// Connect to Huly
const client = await connectRest('https://huly.example.com', {
  email: 'johndoe@example.com',
  password: 'password',
  workspace: 'my-workspace'
})

// Use the client to perform operations
...

```

## Authentication

The client supports two authentication methods: using email and password, or using a token.
When authenticated, the client will have access to the same resources as the user.

> Note: The examples below use the WebSocket client (`connect`). To use the REST client instead, import and call `connectRest` with the same options.

Parameters:

- `url`: URL of the Huly instance, for example `https://huly.example.com`; for Huly Cloud use `https://huly.app`
- `options`: Connection options
  - `workspace`: Name of the workspace to connect to, the workspace name can be found in the URL of the workspace: `https://huly.example.com/workbench/<workspace-name>`
  - `token`: Optional authentication token
  - `email`: Optional user email
  - `password`: Optional user password

### Using Email and Password

```ts
import { connect } from '@hcengineering/api-client'

const client = await connect('https://huly.example.com', {
  email: 'johndoe@example.com',
  password: 'password',
  workspace: 'my-workspace'
})

...

await client.close()
```

### Using Token

Set `HULY_TOKEN` to a valid Huly authentication token for a user who can access the workspace. This does not create a token or restrict its permissions. The complete example below checks the required environment variables before connecting.

```ts
import { connect } from '@hcengineering/api-client'

const client = await connect('https://huly.example.com', {
  token: process.env.HULY_TOKEN!,
  workspace: 'my-workspace'
})

...

await client.close()
```

## Client API

The client provides a set of methods for interacting with the Huly Platform API. This section describes the main methods available in the client.

### Fetch API

The client provides two main methods for retrieving documents: `findOne` and `findAll`.

#### findOne

Retrieves a single document matching the query criteria.

Parameters:

- `_class`: Class of the object to find, results will include all subclasses of the target class
- `query`: Query criteria
- `options`: Find options
  - `limit`: Limit the number of results returned
  - `sort`: Sorting criteria
  - `lookup`: Lookup criteria
  - `projection`: Projection criteria
  - `total`: If specified total will be returned

Example:

```ts
import contact from '@hcengineering/contact'

...

const person = await client.findOne(
  contact.class.Person,
  {
    _id: 'person-id'
  }
)
```

#### findAll

Retrieves multiple document matching the query criteria.

Parameters:

- `_class`: Class of the object to find, results will include all subclasses of the target class
- `query`: Query criteria
- `options`: Find options
  - `limit`: Limit the number of results returned
  - `sort`: Sorting criteria
  - `lookup`: Lookup criteria
  - `projection`: Projection criteria
  - `total`: If specified total will be returned

Example:

```ts
import { SortingOrder } from '@hcengineering/core'
import contact from '@hcengineering/contact'

..

const persons = await client.findAll(
  contact.class.Person,
  {
    city: 'New York'
  },
  {
    limit: 10,
    sort: {
      name: SortingOrder.Ascending
    }
  }
)
```

### Read comments on an issue

This read-only Node.js/TypeScript example uses `@hcengineering/api-client`, `@hcengineering/core`, `@hcengineering/tracker`, and `@hcengineering/chunter`. Install compatible versions of these packages using the registry setup above. Set `HULY_URL`, `HULY_WORKSPACE`, `HULY_TOKEN`, and `HULY_ISSUE` (for example, `ENG-123`) in your environment.

```ts
import { connect } from '@hcengineering/api-client'
import { SortingOrder } from '@hcengineering/core'
import chunter from '@hcengineering/chunter'
import tracker from '@hcengineering/tracker'

async function main (): Promise<void> {
  const { HULY_URL, HULY_WORKSPACE, HULY_TOKEN, HULY_ISSUE } = process.env
  if (!HULY_URL || !HULY_WORKSPACE || !HULY_TOKEN || !HULY_ISSUE) {
    throw new Error('Set HULY_URL, HULY_WORKSPACE, HULY_TOKEN and HULY_ISSUE')
  }

  const client = await connect(HULY_URL, {
    workspace: HULY_WORKSPACE,
    token: HULY_TOKEN
  })

  try {
    const issue = await client.findOne(tracker.class.Issue, { identifier: HULY_ISSUE })
    if (issue === undefined) {
      console.log('Issue not found or not accessible')
      return
    }

    const comments = await client.findAll(
      chunter.class.ChatMessage,
      { attachedTo: issue._id },
      { sort: { createdOn: SortingOrder.Ascending }, limit: 100 }
    )
    for (const comment of comments) {
      console.log(comment._id, comment.message)
    }
    if (comments.length === 0) {
      console.log('No comments found')
    }
  } finally {
    await client.close()
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
```

Comments are `chunter.class.ChatMessage` documents attached to the issue's internal `_id`; the displayed issue identifier is used only to find the issue. `message` contains Huly markup, not plain text. This example reads at most 100 direct comments, excludes activity events such as status changes, and does not traverse comment threads. Results follow the authenticated user's access rights.

### Documents API

The client provides three main methods for managing documents: `createDoc`, `updateDoc`, and `removeDoc`. These methods allow you to perform CRUD operations on documents.

#### createDoc

Creates a new document in the specified space.

Parameters:

- `_class`: Class of the object
- `space`: Space of the object
- `attributes`: Attributes of the object
- `id`: Optional id of the object, if not provided, a new id will be generated

Example:

```ts
import contact, { AvatarType } from '@hcengineering/contact'

..

const personId = await client.createDoc(
  contact.class.Person,
  contact.space.Contacts,
  {
    name: 'Doe,John',
    city: 'New York',
    avatarType: AvatarType.COLOR
  }
)
```

#### updateDoc

Updates existing document.

Parameters:

- `_class`: Class of the object
- `space`: Space of the object
- `objectId`: Id of the object
- `operations`: Attributes of the object to update

Example:

```ts
import contact from '@hcengineering/contact'

..

await client.updateDoc(
  contact.class.Person,
  contact.space.Contacts,
  personId,
  {
    city: 'New York',
  }
)
```

#### removeDoc

Removes existing document.

Parameters:

- `_class`: Class of the object
- `space`: Space of the object
- `objectId`: Id of the object

Example:

```ts
import contact from '@hcengineering/contact'

..

await client.removeDoc(
  contact.class.Person,
  contact.space.Contacts,
  personId
)
```

### Collections API

#### addCollection

Creates a new attached document in the specified collection.

Parameters:

- `_class`: Class of the object to create
- `space`: Space of the object to create
- `attachedTo`: Id of the object to attach to
- `attachedToClass`: Class of the object to attach to
- `collection`: Name of the collection containing attached documents
- `attributes`: Attributes of the object
- `id`: Optional id of the object, if not provided, a new id will be generated

Example:

```ts
import contact, { AvatarType } from '@hcengineering/contact'

..

const personId = await client.createDoc(
  contact.class.Person,
  contact.space.Contacts,
  {
    name: 'Doe,John',
    city: 'New York',
    avatarType: AvatarType.COLOR
  }
)

await client.addCollection(
  contact.class.Channel,
  contact.space.Contacts,
  personId,
  contact.class.Person,
  'channels',
  {
    provider: contact.channelProvider.Email,
    value: 'john.doe@example.com'
  }
)
```

#### updateCollection

Updates existing attached document in collection.

Parameters:

- `_class`: Class of the object to update
- `space`: Space of the object to update
- `objectId`: Space of the object to update
- `attachedTo`: Id of the parent object
- `attachedToClass`: Class of the parent object
- `collection`: Name of the collection containing attached documents
- `attributes`: Attributes of the object to update

Example:

```ts
import contact from '@hcengineering/contact'

..

await client.updateCollection(
  contact.class.Channel,
  contact.space.Contacts,
  channelId,
  personId,
  contact.class.Person,
  'channels',
  {
    city: 'New York',
  }
)
```

#### removeCollection

Removes existing attached document from collection.

Parameters:

- `_class`: Class of the object to remove
- `space`: Space of the object to remove
- `objectId`: Space of the object to remove
- `attachedTo`: Id of the parent object
- `attachedToClass`: Class of the parent object
- `collection`: Name of the collection containing attached documents

Example:

```ts
import contact from '@hcengineering/contact'

..

await client.removeCollection(
  contact.class.Channel,
  contact.space.Contacts,
  channelId,
  personId,
  contact.class.Person,
  'channels'
)
```

### Mixins API

The client provides two methods for managing mixins: `createMixin` and `updateMixin`.

#### createMixin

Creates a new mixin for a specified document.

Parameters:

- `objectId`: Id of the object the mixin is attached to
- `objectClass`: Class of the object the mixin is attached to
- `objectSpace`: Space of the object the mixin is attached to
- `mixin`: Id of the mixin type to update
- `attributes`: Attributes of the mixin

```ts
import contact, { AvatarType } from '@hcengineering/contact'

..

const personId = await client.createDoc(
  contact.class.Person,
  contact.space.Contacts,
  {
    name: 'Doe,John',
    city: 'New York',
    avatarType: AvatarType.COLOR
  }
)

await client.createMixin(
  personId,
  contact.class.Person,
  contact.space.Contacts,
  contact.mixin.Employee,
  {
    active: true,
    position: 'CEO'
  }
)
```

#### updateMixin

Updates an existing mixin.

Parameters:

- `objectId`: Id of the object the mixin is attached to
- `objectClass`: Class of the object the mixin is attached to
- `objectSpace`: Space of the object the mixin is attached to
- `mixin`: Id of the mixin type to update
- `attributes`: Attributes of the mixin to update

```ts
import contact, { AvatarType } from '@hcengineering/contact'

..

const person = await client.findOne(
  contact.class.Person,
  {
    _id: 'person-id'
  }
)

await client.updateMixin(
  personId,
  contact.class.Person,
  contact.space.Contacts,
  contact.mixin.Employee,
  {
    active: false
  }
)
```
