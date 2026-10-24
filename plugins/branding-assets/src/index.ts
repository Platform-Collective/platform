// SPDX-License-Identifier: EPL-2.0

import { loadMetadata } from '@hcengineering/platform'
import branding from '@hcengineering/branding'

const icons = require('../assets/icons.svg') as string // eslint-disable-line
loadMetadata(branding.icon, {
  Branding: `${icons}#branding`,
  Template: `${icons}#template`,
  Text: `${icons}#text`,
  Field: `${icons}#field`,
  Image: `${icons}#image`,
  Rectangle: `${icons}#rectangle`,
  Ellipse: `${icons}#ellipse`,
  Line: `${icons}#line`,
  Page: `${icons}#page`,
  Header: `${icons}#header`,
  Footer: `${icons}#footer`,
  Typography: `${icons}#typography`,
  Watermark: `${icons}#watermark`
})
