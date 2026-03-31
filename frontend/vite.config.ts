import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
const backendTarget = process.env.VITE_API_PROXY_TARGET || 'http://127.0.0.1:8010';

const proxyConfig = {
  '/api': {
    target: backendTarget,
    changeOrigin: true,
  },
  '/health': {
    target: backendTarget,
    changeOrigin: true,
  },
};

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: proxyConfig,
  },
  preview: {
    proxy: proxyConfig,
  },
})
