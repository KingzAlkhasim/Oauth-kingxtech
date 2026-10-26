import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'
export default defineConfig({ plugins: [react()], resolve: { alias: [{ find: /^(\.\.\/lib\/|\.\/)supabase(\.js)?$/, replacement: path.resolve('kxtest/supabase-stub.js') }] } })
