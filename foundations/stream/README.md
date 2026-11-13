# Stream

[![X (formerly Twitter) Follow](https://img.shields.io/twitter/follow/huly_io?style=for-the-badge)](https://x.com/huly_io)
![GitHub License](https://img.shields.io/github/license/hcengineering/platform?style=for-the-badge)

## About

The Stream is a high-performance HTTP-based transcoding service. *Stream* supports the **TUS protocol**, enabling
reliable, resumable transcoding. Designed for seamless and consistent media processing, it supports advanced transcoding
features with robust integration options.

---

## Features

### TUS Protocol Support

- **Resumable transcoding**: Leveraging the TUS protocol, *Stream* ensures reliable and efficient transcoding bucket
  processing.

#### Input Support

- **Supported Input Formats**:
    - `mp4`
    - `webm`

#### Output Options

- **Supported Output Formats**:
    - `hls`

#### Upload options

- **s3 Upload**: Direct upload to S3 storage.
- **datalake Upload**: Upload to datalake storage.

#### Key Functionalities

- **Live transcoding with minimal upload time**: Transcoding results are available after stream completion.
- **Transcoding Cancellation**: Cancel or pause ongoing transcoding in real-time.
- **Transcoding Resumption**: Resume incomplete transcoding tasks efficiently.

### Transcoding scheduling

## Installation

### Prerequisites

- [Go](https://golang.org/dl/) (v1.23+ recommended)
- [ffmpeg](https://www.ffmpeg.org/download.html) (ensure it’s installed and available in your system's PATH)

### Steps

1. Install dependencies:

```bash
go mod tidy
```

2. Build the service:

```bash
docker build . -t hcengineering/stream:latest
```

---

## Configuration

### App Env Configuration

The following environment variables can be used:

```
KEY                                  TYPE             DEFAULT                            DESCRIPTION
STREAM_LOG_LEVEL                     String           debug                              sets log level for the application
STREAM_SERVER_SECRET                 String                                              server secret required to generate and verify tokens
STREAM_PPROF_ENABLED                 True or False    true                               starts profile server on localhost:6060 if true
STREAM_INSECURE                      True or False    false                              ignores authorization check if true
STREAM_SERVE_URL                     String           0.0.0.0:1080                       listens on URL
STREAM_ENDPOINT_URL                  URL              s3://127.0.0.1:9000                S3 or Datalake endpoint, example: s3://my-ip-address, datalake://my-ip-address
STREAM_MAX_PARALLEL_SCALING_COUNT    Integer          2                                  how much parallel scaling can be processed
STREAM_MAX_THREAD_COUNT              Integer          4                                  max number of threads for transcoder
STREAM_OUTPUT_DIR                    String           /tmp/transcoding/                  path to the directory where transcoded files are stored
STREAM_SENTRY_DSN                    String           ""                                 sentry dsn for error tracking
```

### Metadata

**resolution:** if passed, set the resolution for the output, for example, 'resolution: 1920:1080'.

**token:** must be provided to be authorized in the Huly's datalake service.

**workspace:** required for uploading content to the datalake storage.

#### S3 Env configuration

if you're working with S3 storage type, these envs must be provided:
**AWS_ACCESS_KEY_ID**
**AWS_SECRET_ACCESS_KEY**

## Usage

The service exposes an HTTP API.

Below are some examples of how to interact with it.

### Transcode via TUS

```bash
curl -X POST http://localhost:1080/recording \
     -H "Tus-Resumable: 1.0.0" \
     -H "Upload-Length: <file-size>" \
     --data-binary @path/to/your/file.mp4
```

Note: A TUS client is required to play with the service locally.
You can use the tus-js-client example with [video](https://github.com/tus/tus-js-client/blob/main/demos/browser/video.html).

### Schedule a transcoding

```bash
curl -X POST http://localhost:1080/transcoding \
  -H "Content-Type: application/json" \
  -H  "Authorization: Bearer <token>" \
  -d '{
      "source": "<input file name>",
      "format": "hls",
      "workspace": "test"
  }'
```

## Contributing

We welcome contributions! To get started:

1. Fork the repository.
2. Create a new branch for your feature or bug fix.
3. Submit a pull request describing your changes.

---

## License

This project is licensed under the [MIT License](LICENSE).

---

Enjoy seamless transcoding with *Stream*! 🚀

### Recording protocol recovery (opt-in)

`STREAM_RECORDING_RECOVERY_ENABLED` defaults to disabled. Enable it only with a
Datalake multipart backend configured by `STREAM_ENDPOINT_URL`. An unsupported or
missing backend produces a startup warning and disables recovery in the coordinator's
effective configuration; the caller's configuration is not changed.

The server option enables an in-process tus locker, missing-upload 404 responses,
and completed-upload retention for `STREAM_TIMEOUT` (default five minutes). Recovery
PATCH requests have a bounded in-memory buffer. Legacy mode preserves unrestricted
request-body sizes and reports multipart flush errors immediately. Multipart byte
accounting, cancellation and lifecycle safety apply to both modes.

Use one stream replica, or sticky routing that keeps creation and every PATCH, HEAD
and DELETE for an upload on the same instance. Upload state, locks and completion
markers are process-local. Startup logs this routing requirement when recovery is
enabled. A restart loses active upload state and requires a new upload; the server
does not persist checkpoints or recording tokens. Storage lifecycle cleanup is still
required for multipart uploads orphaned by a process crash or failed abort.

With recovery enabled, multipart start and each PATCH's part writes have a one-minute
deadline. Completion retries are bounded to three minutes, with one additional minute
for reconciliation after an ambiguous completion. Failed completion is hidden from
HEAD and left for expiry cleanup. Legacy completion gains no deadline. Cancellation
is bounded to thirty seconds.

#### Upload download compatibility

Live tus upload downloads (`GET` on an upload URL) are no longer supported, including
when recovery is disabled. Consumers must read completed recordings from object
storage. This changes the previous live-download API behavior and must be accounted
for when deploying an external consumer.

This server change does not enable or include browser recording retention or replay.
