//
// Copyright © 2026 Intabia Fusion
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

import { getSelectedMicId, releaseStream } from '@hcengineering/media'
import { get } from 'svelte/store'
import { state as mediaState } from '@hcengineering/media-resources'
import { lkSessionConnected } from './liveKitClient'
import { myPreferences, speakingWhileMuted } from './stores'

const RMS_THRESHOLD = 0.02 // ~ -34 dBFS; above room noise, below normal speech
const POLL_MS = 100
// Speech RMS is bursty (loud syllables between near-silent gaps), so a run of
// consecutive-loud frames rarely forms. Use a leaky score: loud frame charges it,
// quiet frame drains it, flag once it crosses SCORE_TRIGGER.
const SCORE_CHARGE = 2
const SCORE_DRAIN = 1
const SCORE_TRIGGER = 3
const SCORE_MAX = 6
const SILENCE_MS = 1200 // keep the flag this long after last speech

/**
 * Detects the user talking while their microphone is muted and drives the
 * `speakingWhileMuted` store. LiveKit disables the mic MediaStreamTrack on mute
 * (samples go silent), so this opens a dedicated capture stream for the muted
 * window only, runs a light AnalyserNode RMS check, and releases it on unmute.
 * The analyser is observe-only — never connected to a destination or published.
 */
export class SpeakingWhileMutedWatch {
  private stream: MediaStream | null = null
  private ctx: AudioContext | null = null
  private analyser: AnalyserNode | null = null
  private source: MediaStreamAudioSourceNode | null = null
  private pollInterval: ReturnType<typeof setInterval> | undefined
  private clearTimer: ReturnType<typeof setTimeout> | undefined
  private score = 0
  private running = false // whole lifetime of an active watch (incl. async start)

  async start (): Promise<void> {
    if (this.running) return
    this.running = true
    try {
      const micId = getSelectedMicId()
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: micId != null && micId !== '' ? { deviceId: { ideal: micId } } : true
      })
      // Watch may have been stopped (unmute / destroy) while getUserMedia resolved.
      if (!this.running || get(mediaState).microphone?.enabled !== false || !get(lkSessionConnected)) {
        releaseStream(stream)
        return
      }
      this.stream = stream

      // Own AudioContext: LiveKit's context may be suspended while muted (Safari),
      // which freezes the analyser. We're already in a meeting so the OS audio
      // session is taken anyway — no extra CarPlay impact from this context.
      this.ctx = new AudioContext()
      if (this.ctx.state === 'suspended') {
        void this.ctx.resume()
      }
      this.source = this.ctx.createMediaStreamSource(stream)
      this.analyser = this.ctx.createAnalyser()
      this.analyser.fftSize = 512
      this.source.connect(this.analyser)
      this.score = 0

      const buf = new Float32Array(this.analyser.fftSize)
      this.pollInterval = setInterval(() => {
        if (this.analyser == null) return
        this.analyser.getFloatTimeDomainData(buf)
        let sum = 0
        for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i]
        const rms = Math.sqrt(sum / buf.length)
        this.score =
          rms >= RMS_THRESHOLD ? Math.min(SCORE_MAX, this.score + SCORE_CHARGE) : Math.max(0, this.score - SCORE_DRAIN)
        if (this.score >= SCORE_TRIGGER) {
          speakingWhileMuted.set(true)
          if (this.clearTimer != null) clearTimeout(this.clearTimer)
          this.clearTimer = setTimeout(() => {
            speakingWhileMuted.set(false)
          }, SILENCE_MS)
        }
      }, POLL_MS)
    } catch (err) {
      this.running = false
      console.warn('[SpeakingWhileMutedWatch] failed to start', err)
    }
  }

  stop (): void {
    this.running = false
    if (this.pollInterval != null) {
      clearInterval(this.pollInterval)
      this.pollInterval = undefined
    }
    if (this.clearTimer != null) {
      clearTimeout(this.clearTimer)
      this.clearTimer = undefined
    }
    try {
      this.source?.disconnect()
      this.analyser?.disconnect()
      void this.ctx?.close()
    } catch {}
    this.source = null
    this.analyser = null
    this.ctx = null
    releaseStream(this.stream)
    this.stream = null
    this.score = 0
    speakingWhileMuted.set(false)
  }
}

// Single shared watch so multiple indicators (topbar + fullscreen) don't open
// several capture streams. Started when the first indicator mounts and connection
// state warrants it, evaluated on every store change, stopped when the last unmounts.
const sharedWatch = new SpeakingWhileMutedWatch()
let mountedIndicators = 0
let unsubStores: Array<() => void> = []

function evaluateSharedWatch (): void {
  const enabled = get(myPreferences)?.speakingWhileMutedAlert !== false
  if (mountedIndicators > 0 && enabled && get(mediaState).microphone?.enabled === false && get(lkSessionConnected)) {
    void sharedWatch.start()
  } else {
    sharedWatch.stop()
  }
}

export function acquireSpeakingWhileMutedWatch (): () => void {
  mountedIndicators++
  if (unsubStores.length === 0) {
    unsubStores = [
      mediaState.subscribe(evaluateSharedWatch),
      lkSessionConnected.subscribe(evaluateSharedWatch),
      myPreferences.subscribe(evaluateSharedWatch)
    ]
  } else {
    evaluateSharedWatch()
  }
  return () => {
    mountedIndicators = Math.max(0, mountedIndicators - 1)
    if (mountedIndicators === 0) {
      unsubStores.forEach((u) => {
        u()
      })
      unsubStores = []
      sharedWatch.stop()
    }
  }
}
