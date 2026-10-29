/** @type {import('next').NextConfig} */
const nextConfig = {
  async headers() {
    return [
      { source: "/site-data.json", headers: [{ key: "Cache-Control", value: "no-cache, must-revalidate" }] },
      { source: "/site.js", headers: [{ key: "Cache-Control", value: "no-cache, must-revalidate" }] },
    ];
  },
};
export default nextConfig;
