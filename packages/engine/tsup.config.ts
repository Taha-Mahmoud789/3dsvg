import { defineConfig } from "tsup";

export default defineConfig({
  entry: [
    "src/index.tsx",
    "src/scene.tsx",
    "src/controls.tsx",
    "src/materials.ts",
    "src/types.ts",
    "src/use-font.ts",
    "src/png-to-3d.tsx",
  ],
  format: ["esm"],
  dts: true,
  splitting: false,
  sourcemap: false,
  clean: true,
  external: [
    "react",
    "react-dom",
    "three",
    "@react-three/fiber",
    "@react-three/drei",
  ],
  banner: {
    js: '"use client";',
  },
});
