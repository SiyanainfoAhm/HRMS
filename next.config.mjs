/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "api.dicebear.com",
        pathname: "/9.x/**",
      },
    ],
  },
  webpack: (config, { dev }) => {
    // Disable persistent cache to avoid OneDrive/sync issues (ENOENT, module not found)
    if (dev) {
      config.cache = false;
    }
    return config;
  },
};

export default nextConfig;

