//
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
//

package mediaconvert

import (
	"context"
	"fmt"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/pkg/errors"

	"github.com/google/uuid"
	"github.com/hcengineering/stream/internal/pkg/config"
	"github.com/hcengineering/stream/internal/pkg/log"
	"github.com/hcengineering/stream/internal/pkg/manifest"
	"github.com/hcengineering/stream/internal/pkg/storage"
	"github.com/hcengineering/stream/internal/pkg/uploader"
	"github.com/tus/tusd/v2/pkg/handler"
	"go.uber.org/zap"
)

var recordingDir = "r"

// StreamCoordinator represents manager for streams. It creates a new stream for a client and manages it's life cycle.
type StreamCoordinator struct {
	conf          *config.Config
	outputDir     string
	uploadOptions uploader.Options

	mainContext context.Context
	logger      *zap.Logger

	streams sync.Map
}

var _ handler.DataStore = (*StreamCoordinator)(nil)
var _ handler.ConcaterDataStore = (*StreamCoordinator)(nil)
var _ handler.TerminaterDataStore = (*StreamCoordinator)(nil)
var _ handler.LengthDeferrerDataStore = (*StreamCoordinator)(nil)

// NewStreamCoordinator creates a new scheduler for transcode operations.
func NewStreamCoordinator(ctx context.Context, c *config.Config) *StreamCoordinator {
	outputDir := filepath.Join(c.OutputDir, recordingDir)

	return &StreamCoordinator{
		conf:      c,
		outputDir: outputDir,
		uploadOptions: uploader.Options{
			RetryDelay:  time.Millisecond * 100,
			Timeout:     c.Timeout,
			WorkerCount: uint32(c.MaxThreadCount),
			RetryCount:  10,
			BufferSize:  128,
			Dir:         outputDir,
		},
		mainContext: ctx,
		logger:      log.FromContext(ctx).With(zap.String("Scheduler", outputDir)),
	}
}

// NewUpload creates a new worker with passed parameters
func (s *StreamCoordinator) NewUpload(ctx context.Context, info handler.FileInfo) (handler.Upload, error) {
	if info.ID == "" {
		info.ID = uuid.NewString()
	}
	s.logger.Sugar().Debugf("stream: %v", info)
	s.logger.Debug("NewUpload", zap.String("ID", info.ID))

	var stream = &Stream{
		info:         info,
		logger:       log.FromContext(s.mainContext).With(zap.String("stream", info.ID)),
		done:         make(chan struct{}),
		lastActivity: time.Now(),
		legacy:       !s.conf.RecordingRecoveryEnabled,
	}

	width, err := strconv.Atoi(info.MetaData["width"])
	if err != nil {
		return nil, errors.Wrapf(err, "can not parse video width: %v", info.MetaData["width"])
	}

	height, err := strconv.Atoi(info.MetaData["height"])
	if err != nil {
		return nil, errors.Wrapf(err, "can not parse video height: %v", info.MetaData["height"])
	}

	meta := VideoMeta{
		Width:       width,
		Height:      height,
		Codec:       extractCodec(info.MetaData["contentType"]),
		ContentType: extractContentType(info.MetaData["contentType"]),
	}

	if s.conf.RecordingRecoveryEnabled && (s.conf.EndpointURL == nil || s.conf.EndpointURL.Scheme != "datalake") {
		return nil, errors.New("recording requires a multipart-capable storage backend (datalake)")
	}
	if s.conf.EndpointURL != nil {
		s.logger.Sugar().Debugf("initializing uploader for %v", info)

		// setup content uploader for transcoded outputs
		var opts = s.uploadOptions
		opts.Dir = filepath.Join(opts.Dir, info.ID)
		opts.Source = manifest.MasterPlaylistFileName(info.ID)

		// create storage backend
		var stg, err = storage.NewStorageByURL(s.mainContext, s.conf.Endpoint(), s.conf.EndpointURL.Scheme, info.MetaData["token"], info.MetaData["workspace"])
		if err != nil {
			s.logger.Error("can not create storage by url", zap.Error(err))
			return nil, errors.Wrapf(err, "can not create storage")
		}
		stream.storage = stg

		// if storage supports multipart, initialize raw upload
		if ms, ok := stg.(storage.MultipartStorage); ok {
			startCtx := ctx
			cancel := func() {}
			if s.conf.RecordingRecoveryEnabled {
				startCtx, cancel = context.WithTimeout(ctx, time.Minute)
			}
			multipart, err := NewMultipartUpload(startCtx, ms, info, meta.ContentType, s.mainContext)
			cancel()
			if err != nil {
				s.logger.Error("multipart upload failed", zap.Error(err))
				return nil, errors.Wrapf(err, "multipart upload failed")
			}
			stream.multipart = multipart
		} else if s.conf.RecordingRecoveryEnabled {
			return nil, errors.New("recording requires a multipart-capable storage backend (datalake)")
		}
	}

	s.streams.Store(stream.info.ID, stream)

	s.manageTimeout(stream)

	s.logger.Debug("NewUpload", zap.String("done", info.ID))
	return stream, nil
}

// GetUpload returns current a worker based on upload id
func (s *StreamCoordinator) GetUpload(ctx context.Context, id string) (upload handler.Upload, err error) {
	logger := s.logger.With(zap.String("func", "GetUpload")).With(zap.String("id", id))

	if v, ok := s.streams.Load(id); ok {
		logger.Debug("found stream")
		var w = v.(*Stream)
		w.mu.Lock()
		defer w.mu.Unlock()
		if w.terminated || w.completionFailed {
			return nil, handler.ErrNotFound
		}
		w.lastActivity = time.Now()
		return w, nil
	}

	logger.Warn("stream not found")
	if !s.conf.RecordingRecoveryEnabled {
		return nil, fmt.Errorf("stream not found: %v", id)
	}
	return nil, handler.ErrNotFound
}

// AsTerminatableUpload returns tusd handler.TerminatableUpload
func (s *StreamCoordinator) AsTerminatableUpload(upload handler.Upload) handler.TerminatableUpload {
	return upload.(*Stream)
}

// AsLengthDeclarableUpload returns tusd handler.LengthDeclarableUpload
func (s *StreamCoordinator) AsLengthDeclarableUpload(upload handler.Upload) handler.LengthDeclarableUpload {
	return upload.(*Stream)
}

func (s *StreamCoordinator) manageTimeout(w *Stream) {
	go func() {
		done := w.done
		for {
			w.mu.Lock()
			activity := w.lastActivity
			if w.completed {
				activity = w.completedAt
				if w.legacy {
					activity = time.Time{}
				}
			}
			remaining := time.Until(activity.Add(s.conf.Timeout))
			// Check expiry and invalidate under the same lock used to refresh activity.
			if w.terminated || remaining <= 0 {
				ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
				if err := w.terminateLocked(ctx); err != nil {
					w.logger.Warn("recording timeout cleanup failed", zap.Error(err))
				}
				cancel()
				s.streams.Delete(w.info.ID)
				w.mu.Unlock()
				return
			}
			w.mu.Unlock()
			timer := time.NewTimer(remaining)
			select {
			case <-done:
				// Retain successful uploads for Timeout to handle a lost final response without duplicating the blob.
				done = nil
			case <-timer.C:
			case <-s.mainContext.Done():
				// HTTP shutdown still drains active PATCHes; leave their uploads available to finish.
				timer.Stop()
				return
			}
			timer.Stop()
		}
	}()
}

func extractCodec(mimeType string) string {
	codecRegex := regexp.MustCompile(`codecs["\s=]+([^",\s]+)`)
	matches := codecRegex.FindStringSubmatch(mimeType)
	codec := "unknown"
	if len(matches) > 1 {
		codec = matches[1]
	}

	return codec
}

func extractContentType(mimeType string) string {
	contentType := "video/mp4"
	parts := strings.Split(mimeType, ";")
	if parts[0] != "" {
		contentType = strings.TrimSpace(parts[0])
	}
	return contentType
}
