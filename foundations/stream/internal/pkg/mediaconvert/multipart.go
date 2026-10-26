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
	"bytes"
	"context"
	"time"

	"github.com/pkg/errors"

	"github.com/hcengineering/stream/internal/pkg/log"
	"github.com/hcengineering/stream/internal/pkg/storage"
	"github.com/tus/tusd/v2/pkg/handler"
	"go.uber.org/zap"
)

// minimum size for multipart parts (backend requires >=5MiB for all but last part)
const minPartSize = 5 * 1024 * 1024

// MultipartUpload uploads chunks via multipart upload
type MultipartUpload struct {
	logger *zap.Logger
	buffer *bytes.Buffer
	info   handler.FileInfo

	storage     storage.MultipartStorage
	objectName  string
	uploadID    string
	parts       []storage.MultipartPart
	nextPartNum int

	terminated bool
	completed  bool

	bytesWritten  int64
	bytesUploaded int64
}

// NewMultipartUpload creates a new multipart upload
func NewMultipartUpload(
	ctx context.Context,
	multipartStorage storage.MultipartStorage,
	info handler.FileInfo,
	contentType string,
	loggerContext context.Context,
) (*MultipartUpload, error) {
	objectName := info.ID
	uploadID, err := multipartStorage.MultipartUploadStart(ctx, objectName, contentType)
	if err != nil {
		return nil, errors.Wrap(err, "failed to initialize multipart upload")
	}

	logger := log.FromContext(loggerContext).With(zap.String("multipart", "upload"), zap.String("uploadID", uploadID))

	return &MultipartUpload{
		logger:      logger,
		buffer:      bytes.NewBuffer(nil),
		info:        info,
		storage:     multipartStorage,
		objectName:  objectName,
		uploadID:    uploadID,
		parts:       make([]storage.MultipartPart, 0),
		nextPartNum: 1,
	}, nil
}

// Write returns only bytes accepted into the bounded in-memory buffer.
// A failed flush keeps its bytes; flush it before accepting the next request.
func (w *MultipartUpload) Write(ctx context.Context, data []byte) (int, error) {
	if w.terminated || w.completed {
		return 0, errors.New("upload already terminated or completed")
	}
	if err := ctx.Err(); err != nil {
		return 0, err
	}
	if err := w.flush(ctx); err != nil {
		return 0, err
	}
	if len(data) > 4*minPartSize-w.buffer.Len() {
		return 0, errors.New("recording multipart buffer limit exceeded")
	}
	// The context may have been canceled while retrying the previous part.
	if err := ctx.Err(); err != nil {
		return 0, err
	}
	n, err := w.buffer.Write(data)
	w.bytesWritten += int64(n)
	if err != nil {
		return n, err
	}
	// Accepted bytes remain in memory on failure. Report success so tusd finalizes a final PATCH;
	// otherwise a HEAD could expose offset == length without ever calling FinishUpload.
	if err := w.flush(ctx); err != nil {
		w.logger.Warn("multipart flush deferred", zap.Error(err))
	}
	return n, nil
}

func (w *MultipartUpload) flush(ctx context.Context) error {
	for w.buffer.Len() >= minPartSize {
		if err := w.uploadPart(ctx, minPartSize); err != nil {
			return err
		}
	}
	return nil
}

func (w *MultipartUpload) uploadPart(ctx context.Context, size int) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	part, err := w.storage.MultipartUploadPart(ctx, w.objectName, w.uploadID, w.nextPartNum, w.buffer.Bytes()[:size])
	if err != nil {
		w.logger.Error("multipart upload part failed", zap.Int("partNumber", w.nextPartNum), zap.Error(err))
		return errors.Wrap(err, "failed to upload part")
	}
	w.buffer.Next(size)
	w.bytesUploaded += int64(size)
	w.parts = append(w.parts, *part)
	w.nextPartNum++
	return nil
}

// Terminate cancels the upload
func (w *MultipartUpload) Terminate(ctx context.Context) error {
	if w.terminated || w.completed {
		return nil
	}
	w.terminated = true
	w.buffer = bytes.NewBuffer(nil)

	w.logger.Debug("terminating multipart upload", zap.Int("parts", len(w.parts)))

	// create new context in case the main context is canceled
	cancelCtx := ctx
	if ctx.Err() != nil {
		cancelCtx = context.WithoutCancel(ctx)
	}
	cancelCtx, cancel := context.WithTimeout(cancelCtx, 30*time.Second)
	defer cancel()

	if err := w.storage.MultipartUploadCancel(cancelCtx, w.objectName, w.uploadID); err != nil {
		w.logger.Error("multipart upload cancel failed", zap.Error(err))
		return errors.Wrap(err, "failed to cancel multipart upload")
	}

	w.logger.Debug("multipart upload terminated", zap.Int("parts", len(w.parts)))

	return nil
}

// Complete uploads last bytes and completes the upload
func (w *MultipartUpload) Complete(ctx context.Context) error {
	if w.completed {
		return nil
	}

	if w.terminated {
		return errors.New("cannot complete terminated upload")
	}

	w.logger.Debug("finishing multipart upload", zap.Int("parts", len(w.parts)))

	if err := w.flush(ctx); err != nil {
		return err
	}
	if w.buffer.Len() > 0 {
		if err := w.uploadPart(ctx, w.buffer.Len()); err != nil {
			return err
		}
	}

	if len(w.parts) == 0 {
		w.logger.Warn("cannot complete upload with no parts")
		return errors.New("cannot complete upload with no parts")
	}

	if err := w.storage.MultipartUploadComplete(ctx, w.objectName, w.uploadID, w.parts); err != nil {
		w.logger.Error("multipart upload complete failed", zap.Error(err))
		return errors.Wrap(err, "failed to complete multipart upload")
	}

	w.completed = true
	w.buffer = bytes.NewBuffer(nil)
	w.logger.Info(
		"multipart upload completed",
		zap.Int64("bytesUploaded", w.bytesUploaded),
		zap.Int64("bytesWritten", w.bytesWritten),
	)

	return nil
}
