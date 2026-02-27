import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    return [
      {
        source: "/",
        has: [{ type: "host", value: "mychesstour.com" }],
        destination: "https://www.mychesstour.com/landing",
        permanent: true,
      },
      {
        source: "/",
        has: [{ type: "host", value: "www.mychesstour.com" }],
        destination: "/landing",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
