export function createBranchHitTester(stageEl, hitMaskUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image()

    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = img.naturalWidth
      canvas.height = img.naturalHeight

      const ctx = canvas.getContext('2d', { willReadFrequently: true })
      if (!ctx) {
        reject(new Error('Canvas context unavailable for hit mask'))
        return
      }

      ctx.drawImage(img, 0, 0)
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
      const { data, width, height } = imageData

      resolve(function hitTest(clientX, clientY) {
        const rect = stageEl.getBoundingClientRect()

        const localX = (clientX - rect.left) / rect.width
        const localY = (clientY - rect.top) / rect.height

        if (localX < 0 || localX > 1 || localY < 0 || localY > 1) {
          return false
        }

        const maskX = Math.floor(localX * width)
        const maskY = Math.floor(localY * height)

        if (maskX < 0 || maskX >= width || maskY < 0 || maskY >= height) {
          return false
        }

        const i = (maskY * width + maskX) * 4
        const brightness = data[i]
        return brightness > 128
      })
    }

    img.onerror = () => {
      reject(new Error(`Failed to load hit mask: ${hitMaskUrl}`))
    }

    img.src = hitMaskUrl
  })
}

export function analyzeHitMaskConnectivity(src) {
  return new Promise((resolve, reject) => {
    const img = new Image()

    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = img.naturalWidth
      canvas.height = img.naturalHeight

      const ctx = canvas.getContext('2d', { willReadFrequently: true })
      if (!ctx) {
        reject(new Error('Canvas context unavailable'))
        return
      }

      ctx.drawImage(img, 0, 0)
      const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height)

      let total = 0
      let white = 0

      const step = 2
      for (let y = 0; y < height; y += step) {
        for (let x = 0; x < width; x += step) {
          const i = (y * width + x) * 4
          total++
          if (data[i] > 128) white++
        }
      }

      const whiteRatio = total > 0 ? white / total : 0
      const connected = whiteRatio > 0.1 && whiteRatio < 0.9

      resolve({
        src,
        width,
        height,
        whiteRatio,
        verdict: connected
          ? 'VALID_HIT_MASK'
          : 'INVALID_HIT_MASK_RATIO',
      })
    }

    img.onerror = () => {
      reject(new Error(`Failed to load: ${src}`))
    }

    img.src = src
  })
}
