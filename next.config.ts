import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The dev server is opened as http://127.0.0.1:5173; allow its dev resources (HMR, chunks).
  allowedDevOrigins: ["127.0.0.1"],
  // The Docker image runs the self-contained server from .next/standalone (see Dockerfile).
  output: "standalone",
};

export default nextConfig;
