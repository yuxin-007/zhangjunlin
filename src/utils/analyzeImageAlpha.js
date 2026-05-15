export function analyzeImageAlpha(src, options = {}) {
  const {
    sampleStep = 2,
    transparentThreshold = 8,
    semiTransparentThreshold = 245,
  } = options

  return new Promise((resolve, reject) => {
    const img = new Image()

    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = img.naturalWidth
      canvas.height = img.naturalHeight

      const ctx = canvas.getContext('2d', { willReadFrequently: true })
      if (!ctx) {
        reject(new Error(`Canvas context unavailable for ${src}`))
        return
      }

      ctx.clearRect(0, 0, canvas.width, canvas.height)
      ctx.drawImage(img, 0, 0)

      const { data, width, height } = ctx.getImageData(
        0,
        0,
        canvas.width,
        canvas.height
      )

      let sampled = 0
      let fullyTransparent = 0
      let semiTransparent = 0
      let opaque = 0
      let minAlpha = 255
      let maxAlpha = 0

      let edgeSamples = 0
      let lightCheckerLikePixels = 0

      for (let y = 0; y < height; y += sampleStep) {
        for (let x = 0; x < width; x += sampleStep) {
          const i = (y * width + x) * 4
          const r = data[i]
          const g = data[i + 1]
          const b = data[i + 2]
          const a = data[i + 3]

          sampled += 1
          minAlpha = Math.min(minAlpha, a)
          maxAlpha = Math.max(maxAlpha, a)

          if (a <= transparentThreshold) {
            fullyTransparent += 1
          } else if (a < semiTransparentThreshold) {
            semiTransparent += 1
          } else {
            opaque += 1
          }

          const edgeMarginX = width * 0.08
          const edgeMarginY = height * 0.08
          const isEdge =
            x < edgeMarginX ||
            x > width - edgeMarginX ||
            y < edgeMarginY ||
            y > height - edgeMarginY

          if (isEdge) {
            edgeSamples += 1

            const isLightGray =
              Math.abs(r - g) < 8 &&
              Math.abs(g - b) < 8 &&
              r >= 210 &&
              r <= 255

            if (isLightGray && a > 245) {
              lightCheckerLikePixels += 1
            }
          }
        }
      }

      const transparentRatio = fullyTransparent / sampled
      const semiTransparentRatio = semiTransparent / sampled
      const opaqueRatio = opaque / sampled

      const hasRealTransparency =
        fullyTransparent > 0 || semiTransparent > 0 || minAlpha < 255

      const edgeLightGrayRatio =
        edgeSamples > 0 ? lightCheckerLikePixels / edgeSamples : 0

      const likelyBakedCheckerboard =
        !hasRealTransparency && edgeLightGrayRatio > 0.35

      resolve({
        src,
        width,
        height,
        sampled,
        minAlpha,
        maxAlpha,
        fullyTransparent,
        semiTransparent,
        opaque,
        transparentRatio,
        semiTransparentRatio,
        opaqueRatio,
        hasRealTransparency,
        likelyBakedCheckerboard,
        edgeLightGrayRatio,
        verdict: hasRealTransparency
          ? 'REAL_TRANSPARENT_PNG'
          : likelyBakedCheckerboard
            ? 'OPAQUE_IMAGE_WITH_LIKELY_BAKED_CHECKERBOARD'
            : 'OPAQUE_IMAGE',
      })
    }

    img.onerror = () => {
      reject(new Error(`Failed to load image: ${src}`))
    }

    img.src = src
  })
}

export async function analyzeProjectAssets(urls) {
  const results = []
  for (const { name, src } of urls) {
    try {
      const result = await analyzeImageAlpha(src)
      result.name = name
      results.push(result)
    } catch (error) {
      results.push({
        name,
        src,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
  return results
}
