<!--
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
-->
<script lang="ts">
  import Plyr from 'plyr'
  import { onDestroy } from 'svelte'

  export let src: string
  export let name: string | undefined = undefined
  export let poster: string | undefined = undefined
  export let preload = true

  let video: HTMLVideoElement
  let videoWidth = 0
  let videoHeight = 0
  let posterWidth = 0
  let posterHeight = 0
  let player: Plyr | null = null

  const options: Plyr.Options = {
    tooltips: { controls: true, seek: true },
    keyboard: { focused: true, global: true },
    controls: ['play-large', 'play', 'progress', 'current-time', 'mute', 'volume', 'settings', 'fullscreen']
  }

  // Portrait videos get the controls below the video instead of on top of it. The intrinsic size is known only
  // once metadata is loaded, which with preload disabled happens at the first play. Until then use the poster
  // image size; without a poster the layout adjusts once, when metadata arrives.
  $: loadPosterSize(poster)
  $: portrait = isPortrait(videoWidth, videoHeight) ?? isPortrait(posterWidth, posterHeight) ?? false

  function isPortrait(width: number, height: number): boolean | undefined {
    return width > 0 && height > 0 ? height > width : undefined
  }

  function loadPosterSize(url: string | undefined): void {
    posterWidth = 0
    posterHeight = 0
    if (url === undefined || url === '') {
      return
    }
    const img = new Image()
    img.onload = () => {
      if (poster !== url) {
        return
      }
      posterWidth = img.naturalWidth
      posterHeight = img.naturalHeight
    }
    img.src = url
  }

  $: if (video != null) {
    player?.destroy()
    player = new Plyr(video, options)
  }

  onDestroy(() => {
    player?.destroy()
    player = null
  })
</script>

<video
  bind:this={video}
  bind:videoWidth
  bind:videoHeight
  class:portrait
  {src}
  data-poster={poster}
  width="100%"
  height="100%"
  preload={preload ? 'auto' : 'none'}
  disablepictureinpicture
>
  <track kind="captions" label={name ?? ''} />
</video>

<style lang="scss">
  video {
    background: inherit;
    border-radius: inherit;
    object-fit: contain;
  }

  video::-webkit-media-controls {
    visibility: hidden;
  }

  video::-webkit-media-controls-enclosure {
    visibility: visible;
  }

  @import 'plyr/dist/plyr.css';
  :global(.plyr) {
    flex: 1;
    min-width: 10rem;
    border-radius: 0.75rem;
    width: 100%;
    height: 100%;
    --plyr-control-spacing: 0.5rem;
    --plyr-control-icon-size: 1rem;
    --plyr-video-background: transparent;
  }

  // Portrait videos: the controls sit in a fixed-height strip below the video instead of overlaying it.
  // Strip height = control icon + control button padding (2 * 0.7 spacing) + strip padding (2 * spacing).
  :global(.plyr:has(video.portrait)) {
    --portrait-controls-height: calc(var(--plyr-control-icon-size) + var(--plyr-control-spacing) * 3.4);
  }

  :global(.plyr:has(video.portrait) .plyr__video-wrapper) {
    flex: 1;
    min-height: 0;
  }

  // The strip is always visible: override plyr's .plyr--hide-controls slide-out (it would leave an empty strip
  // below the video and make the bar pop in on hover). Selector is more specific than plyr's on purpose.
  :global(.plyr.plyr--video:has(video.portrait) .plyr__controls) {
    position: static;
    flex-shrink: 0;
    width: 100%;
    height: var(--portrait-controls-height);
    padding: var(--plyr-control-spacing);
    background: #000;
    opacity: 1;
    pointer-events: auto;
    transform: none;
  }

  // Center the big play button over the video area, not over video + controls strip
  :global(.plyr:has(video.portrait) .plyr__control--overlaid) {
    top: calc(50% - var(--portrait-controls-height) / 2);
  }

  // Hide controls when video is stopped and not hovered (overlay layout only, see portrait rules above)
  :global(.plyr.plyr--stopped:not(:hover):not(:has(video.portrait)) .plyr__controls) {
    opacity: 0;
    pointer-events: none;
    transform: translateY(100%);
  }
</style>
