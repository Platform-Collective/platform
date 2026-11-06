// SPDX-License-Identifier: EPL-2.0

package mediaconvert

import (
	"bytes"
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strconv"
	"sync"
	"testing"
	"time"

	"github.com/hcengineering/stream/internal/pkg/config"
	"github.com/hcengineering/stream/internal/pkg/log"
	"github.com/hcengineering/stream/internal/pkg/storage"
	"github.com/tus/tusd/v2/pkg/handler"
	"github.com/tus/tusd/v2/pkg/memorylocker"
	"go.uber.org/zap"
)

type recordingStorage struct {
	storage.Storage
	parts                map[int][]byte
	object               []byte
	partCalls            int
	completeCalls        int
	cancelCalls          int
	failPart             bool
	failComplete         bool
	lostCompleteResponse bool
	beforePart           func()
	beforeComplete       func(context.Context)
}

func (s *recordingStorage) MultipartUploadStart(context.Context, string, string) (string, error) {
	return "multipart", nil
}

func (s *recordingStorage) MultipartUploadPart(ctx context.Context, name, id string, number int, data []byte) (*storage.MultipartPart, error) {
	s.partCalls++
	if s.beforePart != nil {
		s.beforePart()
	}
	if s.failPart {
		return nil, errors.New("part failed")
	}
	s.parts[number] = bytes.Clone(data)
	return &storage.MultipartPart{PartNumber: number, ETag: strconv.Itoa(number)}, nil
}

func (s *recordingStorage) MultipartUploadComplete(ctx context.Context, name, id string, parts []storage.MultipartPart) error {
	s.completeCalls++
	if s.beforeComplete != nil {
		s.beforeComplete(ctx)
	}
	if s.failComplete {
		return errors.New("complete failed")
	}
	s.object = nil
	for _, part := range parts {
		s.object = append(s.object, s.parts[part.PartNumber]...)
	}
	if s.lostCompleteResponse {
		return errors.New("completion response lost")
	}
	return nil
}

func (s *recordingStorage) MultipartUploadCancel(context.Context, string, string) error {
	s.cancelCalls++
	return nil
}

func (s *recordingStorage) StatFile(context.Context, string) (*storage.BlobInfo, error) {
	if s.object == nil {
		return nil, errors.New("not found")
	}
	return &storage.BlobInfo{Size: int64(len(s.object))}, nil
}

func recordingContext(t *testing.T) context.Context {
	t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	return log.WithFields(ctx)
}

func newRecording(t *testing.T) (*Stream, *recordingStorage, context.Context) {
	t.Helper()
	ctx := recordingContext(t)
	stg := &recordingStorage{parts: make(map[int][]byte)}
	info := handler.FileInfo{ID: "recording", SizeIsDeferred: true}
	multipart, err := NewMultipartUpload(ctx, stg, info, "video/webm", ctx)
	if err != nil {
		t.Fatal(err)
	}
	return &Stream{
		info: info, multipart: multipart, storage: stg, logger: zap.NewNop(),
		done: make(chan struct{}), lastActivity: time.Now(),
	}, stg, ctx
}

func TestFailedPartRetainsBytesAndBoundsFurtherAcceptance(t *testing.T) {
	w, stg, ctx := newRecording(t)
	data := bytes.Repeat([]byte{7}, minPartSize+13)
	stg.failPart = true
	if n, err := w.WriteChunk(ctx, 0, bytes.NewReader(data)); n != int64(len(data)) || err != nil {
		t.Fatalf("initial accepted write: %d, %v", n, err)
	}
	for i := 0; i < 30; i++ {
		if n, err := w.WriteChunk(ctx, int64(len(data)), bytes.NewReader(data)); n != 0 || err == nil {
			t.Fatalf("blocked write accepted %d bytes: %v", n, err)
		}
		if w.multipart.buffer.Len() != len(data) || w.info.Offset != int64(len(data)) {
			t.Fatal("failed parts grew the buffer or offset")
		}
	}
	stg.failPart = false
	if err := w.DeclareLength(ctx, int64(len(data))); err != nil {
		t.Fatal(err)
	}
	if err := w.FinishUpload(ctx); err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(stg.object, data) {
		t.Fatal("completed bytes differ")
	}
	if len(w.multipart.parts) != 2 {
		t.Fatal("part list differs")
	}
}

func TestWriteRejectsUnacceptedBytes(t *testing.T) {
	t.Run("context canceled after read", func(t *testing.T) {
		w, _, parent := newRecording(t)
		ctx, cancel := context.WithCancel(parent)
		reader := &cancelOnEOF{Reader: bytes.NewReader([]byte("data")), cancel: cancel}
		n, err := w.WriteChunk(ctx, 0, reader)
		if n != 0 || err == nil || w.info.Offset != 0 {
			t.Fatalf("accepted canceled body: %d, %v", n, err)
		}
	})
	t.Run("context canceled after retrying a pending part", func(t *testing.T) {
		w, stg, ctx := newRecording(t)
		stg.failPart = true
		data := bytes.Repeat([]byte{1}, minPartSize)
		if _, err := w.WriteChunk(ctx, 0, bytes.NewReader(data)); err != nil {
			t.Fatal(err)
		}
		ctx, cancel := context.WithCancel(ctx)
		stg.failPart = false
		stg.beforePart = cancel
		n, err := w.WriteChunk(ctx, int64(len(data)), bytes.NewReader([]byte("later")))
		if n != 0 || err == nil || w.info.Offset != int64(len(data)) {
			t.Fatal("accepted canceled append")
		}
	})
	t.Run("terminated", func(t *testing.T) {
		w, _, ctx := newRecording(t)
		if err := w.Terminate(ctx); err != nil {
			t.Fatal(err)
		}
		n, err := w.WriteChunk(ctx, 0, bytes.NewReader([]byte("late")))
		if n != 0 || err == nil || w.info.Offset != 0 {
			t.Fatal("accepted terminated write")
		}
		if err := w.Terminate(ctx); err != nil {
			t.Fatal(err)
		}
	})
}

type cancelOnEOF struct {
	io.Reader
	cancel context.CancelFunc
}

func (r *cancelOnEOF) Read(p []byte) (int, error) {
	n, err := r.Reader.Read(p)
	if err == io.EOF {
		r.cancel()
	}
	return n, err
}

func TestCompleteRetryDoesNotDuplicateFinalPart(t *testing.T) {
	w, stg, ctx := newRecording(t)
	data := []byte("final part")
	if _, err := w.multipart.Write(ctx, data); err != nil {
		t.Fatal(err)
	}
	stg.failComplete = true
	if err := w.multipart.Complete(ctx); err == nil {
		t.Fatal("expected failed complete")
	}
	stg.failComplete = false
	if err := w.multipart.Complete(ctx); err != nil {
		t.Fatal(err)
	}
	if err := w.multipart.Complete(ctx); err != nil {
		t.Fatal(err)
	}
	if stg.partCalls != 1 || len(w.multipart.parts) != 1 || !bytes.Equal(stg.object, data) {
		t.Fatal("completion retried the tail or duplicated parts")
	}
}

func recordingHTTP(t *testing.T, w *Stream, ctx context.Context) (*StreamCoordinator, http.Handler) {
	t.Helper()
	coordinator := NewStreamCoordinator(ctx, &config.Config{Timeout: time.Minute, RecordingRecoveryEnabled: true})
	coordinator.streams.Store(w.info.ID, w)
	composer := handler.NewStoreComposer()
	composer.UseCore(coordinator)
	composer.UseTerminater(coordinator)
	composer.UseLengthDeferrer(coordinator)
	memorylocker.New().UseIn(composer)
	h, err := handler.NewHandler(handler.Config{BasePath: "/recording/", StoreComposer: composer, DisableDownload: true})
	if err != nil {
		t.Fatal(err)
	}
	return coordinator, http.StripPrefix("/recording/", h)
}

func recordingRequest(h http.Handler, method string, body []byte, length bool) *httptest.ResponseRecorder {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	r := httptest.NewRequest(method, "/recording/recording", bytes.NewReader(body)).WithContext(ctx)
	r.Header.Set("Tus-Resumable", "1.0.0")
	if method == http.MethodPatch {
		r.Header.Set("Content-Type", "application/offset+octet-stream")
		r.Header.Set("Upload-Offset", "0")
		if length {
			r.Header.Set("Upload-Length", strconv.Itoa(len(body)))
		}
	}
	response := httptest.NewRecorder()
	h.ServeHTTP(response, r)
	return response
}

func TestHTTPCompletionVisibility(t *testing.T) {
	for _, failure := range []string{"complete", "part", "empty", "lost response", "success"} {
		t.Run(failure, func(t *testing.T) {
			w, stg, ctx := newRecording(t)
			coordinator, h := recordingHTTP(t, w, ctx)
			data := []byte("full recording including final bytes")
			if failure == "part" {
				data = bytes.Repeat([]byte{3}, minPartSize)
			}
			if failure == "empty" {
				data = nil
			}
			stg.failComplete = failure == "complete"
			stg.failPart = failure == "part"
			stg.lostCompleteResponse = failure == "lost response"
			patch := recordingRequest(h, http.MethodPatch, data, true)
			head := recordingRequest(h, http.MethodHead, nil, false)
			if failure == "success" || failure == "lost response" {
				if patch.Code != http.StatusNoContent || head.Code != http.StatusOK {
					t.Fatalf("PATCH/HEAD: %d/%d: %s", patch.Code, head.Code, patch.Body)
				}
				if head.Header().Get("Upload-Offset") != strconv.Itoa(len(data)) || !bytes.Equal(stg.object, data) {
					t.Fatal("HEAD reported success without the exact downloadable object")
				}
				if err := w.FinishUpload(ctx); err != nil {
					t.Fatal(err)
				}
				if err := w.Terminate(ctx); err != nil {
					t.Fatal(err)
				}
				if stg.cancelCalls != 0 {
					t.Fatal("aborted completed object")
				}
			} else {
				if stg.cancelCalls != 0 {
					t.Fatal("failed completion aborted before expiry")
				}
				if patch.Code < 400 || head.Code != http.StatusNotFound {
					t.Fatalf("failed final PATCH is visible as success: %d/%d", patch.Code, head.Code)
				}
				if _, err := coordinator.GetUpload(ctx, w.info.ID); !errors.Is(err, handler.ErrNotFound) {
					t.Fatalf("failed upload remains visible: %v", err)
				}
			}
		})
	}
}

func TestCoordinatorMissingAndUnsupportedBackend(t *testing.T) {
	ctx := recordingContext(t)
	coordinator := NewStreamCoordinator(ctx, &config.Config{RecordingRecoveryEnabled: true})
	if _, err := coordinator.GetUpload(ctx, "missing"); !errors.Is(err, handler.ErrNotFound) {
		t.Fatal(err)
	}
	for _, endpoint := range []*url.URL{nil, {Scheme: "s3", Host: "localhost"}} {
		coordinator.conf.EndpointURL = endpoint
		_, err := coordinator.NewUpload(ctx, handler.FileInfo{MetaData: handler.MetaData{
			"width": "100", "height": "200", "contentType": "video/webm", "workspace": "workspace",
		}})
		if err == nil {
			t.Fatal("unsupported backend accepted")
		}
	}
}

func TestTerminateDoesNotBlockOnRequestBodyAndWriteCannotAppendAfterIt(t *testing.T) {
	w, _, ctx := newRecording(t)
	reader, writer := io.Pipe()
	finished := make(chan struct{})
	go func() {
		defer close(finished)
		n, err := w.WriteChunk(ctx, 0, reader)
		if n != 0 || err == nil {
			t.Errorf("stale body accepted: %d, %v", n, err)
		}
	}()
	if err := w.Terminate(ctx); err != nil {
		t.Fatal(err)
	}
	if _, err := writer.Write([]byte("stale bytes")); err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	select {
	case <-finished:
	case <-time.After(time.Second):
		t.Fatal("body or termination held the lifecycle lock")
	}
}

func TestTimeoutRefreshAndCompletedRetention(t *testing.T) {
	w, _, ctx := newRecording(t)
	coordinator := NewStreamCoordinator(ctx, &config.Config{Timeout: 80 * time.Millisecond, RecordingRecoveryEnabled: true})
	coordinator.streams.Store(w.info.ID, w)
	coordinator.manageTimeout(w)
	// Simulate a PATCH crossing the original deadline. Expiry must recheck activity after taking the lock.
	w.mu.Lock()
	time.Sleep(100 * time.Millisecond)
	w.lastActivity = time.Now()
	w.mu.Unlock()
	if _, err := coordinator.GetUpload(ctx, w.info.ID); err != nil {
		t.Fatalf("stale timeout expired refreshed upload: %v", err)
	}
	if _, err := w.WriteChunk(ctx, 0, bytes.NewReader([]byte("data"))); err != nil {
		t.Fatal(err)
	}
	if err := w.DeclareLength(ctx, 4); err != nil {
		t.Fatal(err)
	}
	if err := w.FinishUpload(ctx); err != nil {
		t.Fatal(err)
	}
	if _, err := coordinator.GetUpload(ctx, w.info.ID); err != nil {
		t.Fatal("completed upload deleted before retry HEAD")
	}
	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		if _, ok := coordinator.streams.Load(w.info.ID); !ok {
			return
		}
		time.Sleep(time.Millisecond)
	}
	t.Fatal("completed upload never expired")
}

func TestShutdownDoesNotAbortDrainingFinalPatch(t *testing.T) {
	for _, legacy := range []bool{false, true} {
		t.Run(strconv.FormatBool(legacy), func(t *testing.T) {
			w, stg, ctx := newRecording(t)
			w.legacy = legacy
			mainCtx, cancel := context.WithCancel(ctx)
			defer cancel()
			coordinator, h := recordingHTTP(t, w, mainCtx)
			coordinator.conf.RecordingRecoveryEnabled = !legacy
			coordinator.manageTimeout(w)

			reader, writer := io.Pipe()
			defer reader.Close()
			defer writer.Close()
			data := []byte("recording including final bytes")
			request := httptest.NewRequest(http.MethodPatch, "/recording/recording", reader)
			request.Header.Set("Tus-Resumable", "1.0.0")
			request.Header.Set("Content-Type", "application/offset+octet-stream")
			request.Header.Set("Upload-Offset", "0")
			request.Header.Set("Upload-Length", strconv.Itoa(len(data)))
			response := httptest.NewRecorder()
			finished := make(chan struct{})
			go func() {
				defer close(finished)
				h.ServeHTTP(response, request)
			}()
			// Keep the final PATCH in its body read, where it does not hold the stream mutex.
			if _, err := writer.Write(data[:9]); err != nil {
				t.Fatal(err)
			}
			cancel()
			// Allow the timeout worker to observe shutdown before releasing the request body.
			time.Sleep(50 * time.Millisecond)
			if _, err := coordinator.GetUpload(request.Context(), w.info.ID); err != nil {
				t.Fatalf("shutdown removed a draining upload: %v", err)
			}
			if _, err := writer.Write(data[9:]); err != nil {
				t.Fatal(err)
			}
			if err := writer.Close(); err != nil {
				t.Fatal(err)
			}
			select {
			case <-finished:
			case <-time.After(5 * time.Second):
				t.Fatal("final PATCH did not finish during shutdown")
			}
			if response.Code != http.StatusNoContent {
				t.Fatalf("final PATCH failed during shutdown: %d: %s", response.Code, response.Body)
			}
			w.mu.Lock()
			defer w.mu.Unlock()
			if stg.cancelCalls != 0 || !w.completed || !bytes.Equal(stg.object, data) {
				t.Fatal("shutdown aborted or lost the completed recording")
			}
		})
	}
}

func TestTerminateSerializesWithBackendWrite(t *testing.T) {
	w, stg, ctx := newRecording(t)
	entered := make(chan struct{})
	release := make(chan struct{})
	stg.beforePart = func() { close(entered); <-release }
	var wg sync.WaitGroup
	wg.Add(2)
	go func() {
		defer wg.Done()
		if _, err := w.WriteChunk(ctx, 0, bytes.NewReader(bytes.Repeat([]byte{1}, minPartSize))); err != nil {
			t.Error(err)
		}
	}()
	<-entered
	go func() {
		defer wg.Done()
		if err := w.Terminate(ctx); err != nil {
			t.Error(err)
		}
	}()
	close(release)
	wg.Wait()
	if stg.cancelCalls != 1 {
		t.Fatal("termination was not idempotent")
	}
}

// Exercise tusd's requestRelease with an actual blocked HTTP body. The interrupted PATCH's
// partial bytes must appear in the next HEAD so that a reconnect resumes at the exact offset.
func TestHTTPLockerReleasesBlockedPatchBeforeHead(t *testing.T) {
	w, _, ctx := newRecording(t)
	_, h := recordingHTTP(t, w, ctx)
	readStarted := make(chan struct{})
	var readOnce sync.Once
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.Method == http.MethodPatch {
			request.Body = &observedBody{ReadCloser: request.Body, notify: func() { readOnce.Do(func() { close(readStarted) }) }}
		}
		h.ServeHTTP(response, request)
	}))
	defer server.Close()
	client := &http.Client{Timeout: 5 * time.Second}
	reader, writer := io.Pipe()
	defer writer.Close()
	request, err := http.NewRequest(http.MethodPatch, server.URL+"/recording/recording", reader)
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("Tus-Resumable", "1.0.0")
	request.Header.Set("Content-Type", "application/offset+octet-stream")
	request.Header.Set("Upload-Offset", "0")
	finished := make(chan struct{})
	go func() {
		defer close(finished)
		response, err := client.Do(request)
		if err == nil {
			response.Body.Close()
		}
	}()
	if _, err := writer.Write([]byte("partial")); err != nil {
		t.Fatal(err)
	}
	select {
	case <-readStarted:
	case <-time.After(5 * time.Second):
		t.Fatal("PATCH did not start reading")
	}
	head, err := http.NewRequest(http.MethodHead, server.URL+"/recording/recording", nil)
	if err != nil {
		t.Fatal(err)
	}
	head.Header.Set("Tus-Resumable", "1.0.0")
	response, err := client.Do(head)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK || response.Header.Get("Upload-Offset") != "7" {
		t.Fatalf("HEAD failed to serialize partial body: status=%d offset=%s", response.StatusCode, response.Header.Get("Upload-Offset"))
	}
	writer.Close()
	<-finished
}

type observedBody struct {
	io.ReadCloser
	notify func()
}

func (r *observedBody) Read(data []byte) (int, error) {
	n, err := r.ReadCloser.Read(data)
	if n > 0 {
		r.notify()
	}
	return n, err
}

func TestRecoveryProtocolIsOptIn(t *testing.T) {
	ctx := recordingContext(t)
	coordinator := NewStreamCoordinator(ctx, &config.Config{Timeout: time.Minute})
	if _, err := coordinator.GetUpload(ctx, "missing"); err == nil || errors.Is(err, handler.ErrNotFound) {
		t.Fatal("default missing-upload response changed")
	}
	// The legacy no-backend path is preserved until explicitly enabled; recovery mode rejects it above.
	upload, err := coordinator.NewUpload(ctx, handler.FileInfo{SizeIsDeferred: true, MetaData: handler.MetaData{
		"width": "100", "height": "200", "contentType": "video/webm", "workspace": "workspace",
	}})
	if err != nil {
		t.Fatal(err)
	}
	if n, err := upload.WriteChunk(ctx, 0, bytes.NewReader([]byte("legacy"))); n != 6 || err != nil {
		t.Fatalf("default backend behavior changed: %d, %v", n, err)
	}
	if err := upload.FinishUpload(ctx); err != nil {
		t.Fatal(err)
	}
}

// Completion can legitimately take minutes; only recovery mode adds a deadline.
func TestCompletionDeadlineAndDeferredCleanup(t *testing.T) {
	for _, legacy := range []bool{false, true} {
		t.Run(strconv.FormatBool(legacy), func(t *testing.T) {
			w, stg, ctx := newRecording(t)
			w.legacy = legacy
			if _, err := w.WriteChunk(ctx, 0, bytes.NewReader([]byte("recording"))); err != nil {
				t.Fatal(err)
			}
			if err := w.DeclareLength(ctx, 9); err != nil {
				t.Fatal(err)
			}
			stg.beforeComplete = func(ctx context.Context) {
				deadline, bounded := ctx.Deadline()
				if legacy && bounded {
					t.Fatal("legacy completion gained a deadline")
				}
				if !legacy && (!bounded || time.Until(deadline) < 2*time.Minute) {
					t.Fatal("recovery completion deadline is too short")
				}
			}
			stg.failComplete = true
			if err := w.FinishUpload(ctx); err == nil {
				t.Fatal("expected completion failure")
			}
			if stg.cancelCalls != 0 || w.terminated {
				t.Fatal("ambiguous completion aborted immediately")
			}
			if _, err := w.GetInfo(ctx); !errors.Is(err, handler.ErrNotFound) {
				t.Fatal("failed completion metadata exposed")
			}
			if err := w.Terminate(ctx); err != nil {
				t.Fatal(err)
			}
			if stg.cancelCalls != 1 {
				t.Fatal("expiry cleanup did not cancel multipart")
			}
		})
	}
}
