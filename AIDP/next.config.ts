import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * The baseline standards library ships as six `.xlsx` files that
   * `seedStandardLibrary` reads off disk at run time. Nothing imports them, so
   * the build's file tracing cannot see them, and they would be missing from
   * the deployed function — seeding would fail in production having worked
   * everywhere locally.
   *
   * Top-level rather than under `experimental` in Next 16; the key is a route
   * glob and the value is resolved from the project root. `"/*"` because
   * seeding is reachable from a server action on the documents page and from
   * `scripts/`, and a narrower key would silently stop covering it the first
   * time either moved.
   */
  outputFileTracingIncludes: {
    "/*": ["src/lib/standards-library/files/**/*"],
  },
  experimental: {
    serverActions: {
      /**
       * Raised for the staff-list import on /dashboard/people.
       *
       * The default is 1MB. A .xlsx export of a few thousand employees is
       * comfortably under 4MB — the format is a zip, and this data is text —
       * while still being far too small to be worth a separate upload endpoint
       * with its own auth. Documents, which really are tens of megabytes, go
       * through the Route Handler at /api/documents/upload instead and are not
       * affected by this.
       *
       * The limit counts multipart overhead as well as the file, hence the
       * headroom over the number quoted to the user in ImportPanel.
       */
      bodySizeLimit: "6mb",
    },
  },
};

export default nextConfig;
