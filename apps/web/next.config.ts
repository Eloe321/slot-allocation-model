import type { NextConfig } from 'next';

const config: NextConfig = {
  output: 'export',
  env: { NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4001' },
};

export default config;
