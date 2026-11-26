# Docker Compose dev image

## Running platform inside docker compose

```bash
rush build
rush bundle
rush docker:build
docker compose up -d --force-recreate
```

## Receiving emails locally

Emails (sign-in codes, invites, notifications) go to a local Mailpit inbox with the mail overlay:

```bash
docker compose -f docker-compose.yaml -f docker-compose.mail.yaml up -d
```

Open the inbox at http://localhost:8025. With the overlay the login page switches to sign-in by email code.
Email notifications reach only users with a verified email who enabled email delivery in Settings → Notifications.

## Running ElasticVUE to check elastic intance

```bash
docker run -p 8082:8080 -d cars10/elasticvue
```

## Running Local NPM registry with Docker

```bash
docker run -it --rm --name verdaccio -p 4873:4873 verdaccio/verdaccio
```

```bash
npm set registry http://localhost:4873
npm adduser
npm login
```

Verdaccio will be available via HTTP http://localhost:4873