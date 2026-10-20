import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Static site: `npm run build` writes everything to dist/ (see .openai/hosting.json).
export default defineConfig({
  base: "./",
  build: {
    outDir: "dist",
    target: "es2022",
  },
  plugins: [react()],
});
