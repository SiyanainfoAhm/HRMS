/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  webpack: (config, { dev }) => {
    // Disable persistent cache to avoid OneDrive/sync issues (ENOENT, module not found)
    if (dev) {
      config.cache = false;
    }
    return config;
  },
};

export default nextConfig;

