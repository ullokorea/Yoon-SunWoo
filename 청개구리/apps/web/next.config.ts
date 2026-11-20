import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // 모노레포 TS 패키지를 직접 트랜스파일
  transpilePackages: ['@cheong/core', '@cheong/server', '@cheong/design-tokens'],
  // WASM/네이티브 의존성은 번들하지 않고 Node 에서 직접 로드
  serverExternalPackages: ['@electric-sql/pglite', 'postgres'],
  poweredByHeader: false,
  turbopack: {
    rules: {
      '*.css': {
        loaders: ['@tailwindcss/turbopack'],
        as: '*.css',
      },
    },
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Permissions-Policy', value: 'camera=(self), geolocation=(self)' },
        ],
      },
    ];
  },
};

export default nextConfig;
