import React from 'react'
import { ASSET_URLS } from '../assetPaths'

export default function HeroBranchLayer() {
  return (
    <img
      className="branch-image"
      src={ASSET_URLS.branchMain}
      alt=""
    />
  )
}
