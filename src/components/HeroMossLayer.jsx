import React from 'react'
import { ASSET_URLS } from '../assetPaths'

export default function HeroMossLayer() {
  return (
    <img
      className="moss-base-image"
      src={ASSET_URLS.mossPatchBase}
      alt=""
    />
  )
}
