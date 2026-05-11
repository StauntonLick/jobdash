import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Allow access from local network and Tailscale IPs (100.x.x.x) in dev mode
  allowedDevOrigins: ["192.168.86.244", "100.*.*.*"],
};

export default nextConfig;
