import type { NextConfig } from "next";

const allowedOrigins = process.env.ALLOWED_DEV_ORIGINS
  ? process.env.ALLOWED_DEV_ORIGINS.split(",").map((s) => s.trim())
  : [
      "genesis.innotel.us",
      "app.genesis.innotel.us",
      "api.genesis.innotel.us",
      "localhost",
    ];

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["better-sqlite3"],
  allowedDevOrigins: allowedOrigins,
};

export default nextConfig;
