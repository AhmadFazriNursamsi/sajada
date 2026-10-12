import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The dev server is opened as http://127.0.0.1:5173; allow its dev resources (HMR, chunks).
  allowedDevOrigins: ["127.0.0.1"],
};

export default nextConfig;
