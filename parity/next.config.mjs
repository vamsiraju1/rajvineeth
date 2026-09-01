import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const here = path.dirname(fileURLToPath(import.meta.url));
// The API key lives in the assignment folder's .env, one level up.
dotenv.config({ path: path.join(here, "..", ".env") });

/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ["sharp", "exceljs", "pdfkit"],
};

export default nextConfig;
