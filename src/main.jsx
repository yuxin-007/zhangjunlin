import React, { useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import { ASSET_URLS } from './assetPaths'
import './styles.css'

function DevAlphaCheck() {
  useEffect(() => {
    if (import.meta.env.DEV) {
      import('./utils/analyzeImageAlpha.js').then(({ analyzeProjectAssets }) => {
        analyzeProjectAssets([
          { name: 'branch-main.png', src: ASSET_URLS.branchMain },
          { name: 'moss-patch-base.png', src: ASSET_URLS.mossPatchBase },
          { name: 'branch-hit-mask.png', src: ASSET_URLS.branchHitMask },
        ]).then((results) => {
          console.group('[Asset alpha check]')
          results.forEach((result) => {
            console.log(result.name || result.src, result)
          })
          console.groupEnd()
        })
      }).catch((err) => {
        console.warn('[Asset alpha check] failed:', err)
      })
    }
  }, [])

  return null
}

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <DevAlphaCheck />
    <App />
  </React.StrictMode>,
)
