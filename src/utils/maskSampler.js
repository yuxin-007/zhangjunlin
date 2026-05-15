export function createMaskSampler(maskUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image()

    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = img.naturalWidth
      canvas.height = img.naturalHeight

      const ctx = canvas.getContext('2d', { willReadFrequently: true })
      if (!ctx) {
        reject(new Error('Canvas context unavailable for mask sampler'))
        return
      }

      ctx.drawImage(img, 0, 0)
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
      const { data, width, height } = imageData

      resolve(function sampleMask(uv) {
        const maskX = Math.floor(uv.x * width)
        // Three.js UV origin is bottom-left, Canvas origin is top-left — flip Y
        const maskY = Math.floor((1.0 - uv.y) * height)

        if (maskX < 0 || maskX >= width || maskY < 0 || maskY >= height) {
          return { isHit: false, brightness: 0, maskX, maskY }
        }

        const i = (maskY * width + maskX) * 4
        const brightness = data[i]

        return {
          isHit: brightness > 128,
          brightness,
          maskX,
          maskY,
        }
      })
    }

    img.onerror = () => {
      reject(new Error(`Failed to load mask image: ${maskUrl}`))
    }

    img.src = maskUrl
  })
}
