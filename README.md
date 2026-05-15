# Moss coverage interaction fix

Replace these files in your project:

- `src/components/HeroVisual.jsx`
- `src/components/MossInteractivePlane.jsx`

Main fix:

1. `paintMossCoverage` was previously defined at module scope but referenced `coverageCanvasRef`, `coverageCtxRef`, and `coverageTextureRef` that only exist inside `HeroVisual`. On the first valid branch hit this throws a runtime `ReferenceError`, which makes the moss interaction appear dead.
2. This patch moves `paintMossCoverage` inside `HeroVisual`, so it can access the refs safely.
3. It also initializes `uCoverageMap` directly when creating the moss material, keeps it synchronized in `useFrame`, and adds `onPointerDown` for click testing.
4. Normal `?debug=1` now shows panels without replacing the main visual. Use `?debug=1&shaderDebug=coverage` to replace the main visual with the grayscale coverage map, or `?debug=1&shaderDebug=mask` to show coverage in red and branch mask in green.

After replacing, run:

```bash
npm run dev
```

Open:

- normal: `http://localhost:5173/`
- debug: `http://localhost:5173/?debug=1`
- coverage shader debug: `http://localhost:5173/?debug=1&shaderDebug=coverage`
- coverage vs branch mask debug: `http://localhost:5173/?debug=1&shaderDebug=mask`
