import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The badge sits on top of the canvas zoom controls; errors still show.
  devIndicators: false,
  cacheComponents: true,
  // mupdf loads its WASM from node_modules, so it must not be bundled.
  serverExternalPackages: ["mupdf"],
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
