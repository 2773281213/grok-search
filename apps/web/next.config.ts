import { resolve } from 'node:path';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Windows without Developer Mode cannot create the symlinks used by Next's
  // standalone tracer. Production builds run on Linux and retain standalone.
  ...(process.platform === 'win32' ? {} : { output: 'standalone' as const }),
  outputFileTracingRoot: resolve(process.cwd(), '../..'),
  transpilePackages: ['@cairn/shared', '@cairn/storage', '@cairn/providers', '@cairn/search-core'],
  serverExternalPackages: ['better-sqlite3'],
  poweredByHeader: false,
  webpack(config, { isServer }) {
    // 工作区包以 TS 源码导出，同时保留 Node ESM 的 .js import 写法。
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      '.js': ['.ts', '.tsx', '.js'],
      '.jsx': ['.tsx', '.jsx'],
    };
    // `better-sqlite3` must keep a native Node require. The explicit webpack
    // external also covers the package when imported through a transpiled
    // monorepo workspace package.
    if (isServer) {
      config.externals.push({ 'better-sqlite3': 'commonjs better-sqlite3' });
    }
    return config;
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
};

export default nextConfig;
