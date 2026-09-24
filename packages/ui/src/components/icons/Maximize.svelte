<!--
// Copyright © 2023 Hardcore Engineering Inc.
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
  import { IconSize } from '../../types'
  export let size: IconSize
  const fill: string = 'currentColor'
</script>

<svg class="svg-{size}" {fill} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
  <path
    fill-rule="evenodd"
    clip-rule="evenodd"
    d="M14.2929 14.293C14.6834 13.9024 15.3164 13.9024 15.707 14.293L19.9999 18.5859V16C19.9999 15.4477 20.4477 15 20.9999 15C21.5522 15 21.9999 15.4477 21.9999 16V22H15.9999C15.4477 22 15 21.5522 14.9999 21C14.9999 20.4477 15.4477 20 15.9999 20H18.5859L14.2929 15.707C13.9024 15.3165 13.9024 14.6835 14.2929 14.293ZM21.9999 8C21.9999 8.55225 21.5522 8.99996 20.9999 9C20.4477 8.99999 19.9999 8.55227 19.9999 8V5.41406L15.707 9.70703C15.3164 10.0975 14.6834 10.0975 14.2929 9.70703C13.9024 9.31651 13.9024 8.68349 14.2929 8.29297L18.5859 4H15.9999C15.4477 3.99999 14.9999 3.55227 14.9999 3C14.9999 2.44773 15.4477 2.00001 15.9999 2H21.9999V8Z"
  />
  <path
    fill-rule="evenodd"
    clip-rule="evenodd"
    d="M8.29297 14.2929C8.68349 13.9024 9.31651 13.9024 9.70703 14.2929C10.0976 14.6834 10.0976 15.3164 9.70703 15.707L5.41406 19.9999H8C8.55228 19.9999 8.99999 20.4476 9 20.9999C9 21.5522 8.55228 21.9999 8 21.9999H2V15.9999C2.00001 15.4477 2.44773 14.9999 3 14.9999C3.55228 14.9999 3.99999 15.4476 4 15.9999V18.5859L8.29297 14.2929Z"
  />
  <path
    d="M8 2C8.55228 2 9 2.44772 9 3C9 3.55228 8.55228 4 8 4H5.41406L9.70703 8.29297C10.0976 8.68349 10.0976 9.31651 9.70703 9.70703C9.31651 10.0976 8.68349 10.0976 8.29297 9.70703L4 5.41406V8C4 8.55228 3.55228 9 3 9C2.44772 9 2 8.55228 2 8V2H8Z"
  />
</svg>
