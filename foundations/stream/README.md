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

### Recording recovery (opt-in)

Enable `RECORDING_RECOVERY_ENABLED=true` on the front service (or set that string in its
public config), and `STREAM_RECORDING_RECOVERY_ENABLED=true` on the stream service. Both
default to disabled. Web and desktop clients read the same public configuration. The
server switch enables the in-process tus locker, 404 responses for missing uploads, and
completed-upload retention for `STREAM_TIMEOUT` (default 5 minutes). It also rejects
recording creation without a multipart-capable backend. Use
`STREAM_ENDPOINT_URL=datalake://<datalake-host>:<port>`; the recorded workspace and token
must be accepted by that Datalake. `STREAM_INSECURE=true` selects HTTP for a local
Datalake test setup. The documented S3 default and the root `tests/docker-compose.yaml` S3
configuration do not support recording multipart uploads. With recovery enabled those
POSTs fail explicitly; S3 multipart support is outside this recovery mode. Without the
switch the legacy protocol/backend behavior is preserved. Multipart accounting and
lifecycle safety fixes apply to both modes.

Recovery requires the same browser session to remain open. The client retains
MediaRecorder chunks in memory, up to 512 MiB per recording (roughly 17 minutes at the
default 4 Mbit/s video rate, less with audio or higher bitrates). This is a retention
limit, not a total browser-memory limit. Exceeding it logs a warning, disables recovery
for that recording, and lets the original live upload continue. If that upload has already
failed, queued data is discarded and the failure is reported promptly. Cancel and terminal
failure discard future chunks as well.

On any terminal upload error, the client best-effort terminates that upload, continues
capturing within the cap, and waits for the final data/stop event before one fresh upload
of the complete seekable Blob. A MediaRecorder error preserves its final dataavailable
event and lets the healthy live upload finish after stop, including when recovery is
disabled or the cap was exceeded. Only an upload failure starts replay. Uploading
preserves emitted bytes but cannot repair missing/corrupt media from the capture failure.
A missing recorder stop event fails after 5 seconds and releases capture resources. The
client waits up to 10 minutes when explicitly offline after capture closes. An online
browser does not prove the endpoint is reachable. Requests time out after 6 minutes,
allowing the final PATCH to flush and complete large recordings; retries have a 3-minute
outage watchdog after the first error, reset only by accepted chunk progress. Keep this
budget below `STREAM_TIMEOUT`; expiry of the original server upload still permits fresh
replay. The replay has its own retry budget. Best-effort DELETE has a separate 5-second
deadline and never blocks local cancellation or replay. With server recovery enabled,
Datalake upload start and each PATCH's part writes are bounded to 1 minute, completion
retries to 3 minutes, and a final reconciliation stat to 1 additional minute if completion
timed out. Legacy completion has no new deadline. Cancellation is bounded to 30 seconds.
Failed completion is hidden from HEAD; ambiguous backend operations are left for expiry
cleanup rather than aborted immediately.

This implementation assumes a **single stream-service instance**. Upload state, locks, and
successful-completion markers are process-local. A restart requires a fresh client replay.
No schema migration, checkpoint, token on disk, or writable recording volume is
introduced. Server restarts and failed aborts can orphan backend multipart uploads:
operators must configure backend lifecycle cleanup. The service does not sweep or
guarantee cleanup of those orphans. Successful objects whose response was lost are
reconciled by stat and size within the surviving process. A restart or a backend
completion that succeeds after reconciliation can still require replay and create a
duplicate completed blob. Token expiry can prevent replay. Existing upload-URL
capability/authentication semantics are unchanged.

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
