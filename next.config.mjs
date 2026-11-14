import path from "node:path";
import { fileURLToPath } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));

/** Static export so the dashboard can be hosted on Netlify / Firebase Hosting. */
const nextConfig = {
  output: "export", images: { unoptimized: true },
  // QA ONLY: `QA_MOCK_FIREBASE=1 next build` swaps Firebase for an in-memory stand-in so the UI can be tested in a browser. Never set in production.
  ...(process.env.QA_MOCK_FIREBASE ? {
    distDir: ".next-qa",
    webpack(config, { isServer }) {
      config.resolve.alias["firebase/database"] = path.join(here, "qa/mock-database.js");
      config.resolve.alias["firebase/auth"] = path.join(here, "qa/mock-auth.js");
      return config;
    }
  } : {})
};
export default nextConfig;
