// Copyright © 2025 Hardcore Engineering Inc.
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//
// See the License for the specific language governing permissions and
// limitations under the License.

// Package mediaconvert provides types and functions for video transcoding
package mediaconvert

import (
	"context"
	"io"
	"sync"
	"time"

	"github.com/hcengineering/stream/internal/pkg/storage"
	"github.com/hcengineering/stream/internal/pkg/tracing"
	"github.com/pkg/errors"
	"github.com/tus/tusd/v2/pkg/handler"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/trace"
	"go.uber.org/zap"
)

// Stream manages a raw recording. State and backend operations are serialized independently of HTTP locks.
type Stream struct {
	mu               sync.Mutex
	logger           *zap.Logger
	info             handler.FileInfo
	storage          storage.Storage
	multipart        *MultipartUpload
	done             chan struct{}
	doneOnce         sync.Once
	terminated       bool
	legacy           bool
	completed        bool
	completionFailed bool
	lastActivity     time.Time
	completedAt      time.Time
}

var _ handler.Upload = (*Stream)(nil)
var _ handler.ConcatableUpload = (*Stream)(nil)
var _ handler.TerminatableUpload = (*Stream)(nil)
var _ handler.LengthDeclarableUpload = (*Stream)(nil)

// WriteChunk reads the request without holding the lifecycle mutex. tusd's locker serializes requests.
func (w *Stream) WriteChunk(ctx context.Context, offset int64, src io.Reader) (int64, error) {
	ctx, span := tracer.Start(ctx, "WriteChunk", trace.WithAttributes(
		attribute.String("workspace", w.info.MetaData["workspace"]),
		attribute.String("upload_id", w.info.ID),
	))
	defer span.End()

	// Bound the request allocation too; the browser sends 2 MiB chunks.
	data, err := io.ReadAll(io.LimitReader(src, 4*minPartSize+1))
	if err != nil {
		tracing.RecordError(span, err)
		return 0, err
	}
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.terminated || w.completionFailed {
		return 0, handler.ErrNotFound
	}
	if w.completed || offset != w.info.Offset {
		return 0, errors.New("recording offset mismatch or upload already completed")
	}
	if w.multipart == nil && w.legacy {
		w.info.Offset += int64(len(data))
		return int64(len(data)), nil
	}
	if w.multipart == nil {
		return 0, errors.New("recording requires a multipart-capable storage backend (datalake)")
	}
	w.logger.Debug("Write Chunk start", zap.Int64("offset", w.info.Offset))
	if !w.legacy {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, time.Minute)
		defer cancel()
	}
	n, err := w.multipart.Write(ctx, data)
	if err != nil {
		tracing.RecordError(span, err)
		w.logger.Error("multipart upload part failed", zap.Error(err))
	}
	w.info.Offset += int64(n)
	w.lastActivity = time.Now()
	w.logger.Debug("write chunk end", zap.Int64("offset", w.info.Offset), zap.Error(err))
	return int64(n), err
}

// DeclareLength sets the final recording length.
func (w *Stream) DeclareLength(ctx context.Context, length int64) error {
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.terminated || w.completionFailed {
		return handler.ErrNotFound
	}
	if w.completed {
		return errors.New("recording already completed")
	}
	w.info.Size = length
	w.info.SizeIsDeferred = false
	w.logger.Debug("DeclareLength", zap.Int64("size", length), zap.Bool("SizeIsDeferred", w.info.SizeIsDeferred))
	return nil
}

// GetInfo gates completion visibility on backend success when recovery is enabled.
func (w *Stream) GetInfo(ctx context.Context) (handler.FileInfo, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.logger.Debug("GetInfo is executed")
	if w.terminated || w.completionFailed {
		return handler.FileInfo{}, handler.ErrNotFound
	}
	if !w.info.SizeIsDeferred && w.info.Offset == w.info.Size && !w.completed && !w.legacy {
		if err := w.finishLocked(ctx); err != nil {
			return handler.FileInfo{}, err
		}
	}
	return w.info, nil
}

// GetReader is disabled: recordings have no live download or transcode consumer.
func (w *Stream) GetReader(ctx context.Context) (io.ReadCloser, error) {
	return nil, errors.New("recording download is disabled")
}

// Terminate is idempotent, including when called by timeout and DELETE concurrently.
func (w *Stream) Terminate(ctx context.Context) error {
	ctx, span := tracer.Start(ctx, "Terminate", trace.WithAttributes(
		attribute.String("workspace", w.info.MetaData["workspace"]),
		attribute.String("upload_id", w.info.ID),
	))
	defer span.End()

	w.mu.Lock()
	defer w.mu.Unlock()
	w.logger.Debug("terminate upload")
	err := w.terminateLocked(ctx)
	if err != nil {
		tracing.RecordError(span, err)
		w.logger.Error("multipart upload cancel failed", zap.Error(err))
	}
	return err
}

func (w *Stream) terminateLocked(ctx context.Context) error {
	if w.terminated || w.completed {
		return nil
	}
	w.terminated = true
	w.doneOnce.Do(func() { close(w.done) })
	if w.multipart != nil {
		return w.multipart.Terminate(ctx)
	}
	return nil
}

// ConcatUploads is not used by the recording client.
func (w *Stream) ConcatUploads(ctx context.Context, partialUploads []handler.Upload) error {
	w.logger.Debug("ConcatUploads was executed, it's not implemented")
	return errors.New("not implemented")
}

// FinishUpload publishes the completed object before making completion visible to HEAD.
func (w *Stream) FinishUpload(ctx context.Context) error {
	ctx, span := tracer.Start(ctx, "FinishUpload", trace.WithAttributes(
		attribute.String("workspace", w.info.MetaData["workspace"]),
		attribute.String("upload_id", w.info.ID),
	))
	defer span.End()

	w.mu.Lock()
	defer w.mu.Unlock()
	w.logger.Debug("finish upload")
	err := w.finishLocked(ctx)
	if err != nil {
		tracing.RecordError(span, err)
		w.logger.Error("multipart upload complete failed", zap.Error(err))
	}
	return err
}

func (w *Stream) finishLocked(ctx context.Context) error {
	if w.terminated {
		return handler.ErrNotFound
	}
	if w.completed {
		return nil
	}
	if w.multipart == nil && w.legacy {
		w.completed = true
		w.doneOnce.Do(func() { close(w.done) })
		return nil
	}
	if w.multipart == nil {
		return errors.New("recording requires a multipart-capable storage backend (datalake)")
	}
	finishCtx := ctx
	if !w.legacy {
		var cancel context.CancelFunc
		finishCtx, cancel = context.WithTimeout(ctx, 3*time.Minute)
		defer cancel()
	}
	var err error
	for attempt := 0; attempt < 3; attempt++ {
		err = w.multipart.Complete(finishCtx)
		if err == nil {
			break
		}
		// The backend may have completed successfully but lost its response. UUIDs are unique per recording.
		if w.storage != nil && w.multipart.buffer.Len() == 0 && len(w.multipart.parts) > 0 {
			statCtx := finishCtx
			cancel := func() {}
			if !w.legacy && finishCtx.Err() != nil {
				// Completion may have outlived the request. Reconcile with an independent bounded stat.
				statCtx, cancel = context.WithTimeout(context.WithoutCancel(ctx), time.Minute)
			}
			info, statErr := w.storage.StatFile(statCtx, w.info.ID)
			cancel()
			if statErr == nil && info.Size == w.info.Offset {
				w.multipart.completed = true
				err = nil
				break
			}
		}
		if finishCtx.Err() != nil {
			break
		}
		if attempt < 2 {
			select {
			case <-time.After(100 * time.Millisecond):
			case <-finishCtx.Done():
			}
		}
	}
	if err != nil {
		// Hide incomplete metadata from HEAD, but do not abort a completion that may still be running.
		// Expiry owns cleanup after ambiguous errors.
		w.completionFailed = true
		w.lastActivity = time.Now()
		return err
	}
	w.completed = true
	w.completionFailed = false
	w.completedAt = time.Now()
	w.doneOnce.Do(func() { close(w.done) })
	return nil
}

// AsConcatableUpload returns tusd handler.ConcatableUpload.
func (s *StreamCoordinator) AsConcatableUpload(upload handler.Upload) handler.ConcatableUpload {
	s.logger.Debug("AsConcatableUpload is executed")
	return upload.(*Stream)
}
