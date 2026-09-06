import { buildLocalCompanionInstaller } from "@/lib/server/localCompanionInstaller";

export const runtime = "nodejs";

export async function GET() {
  const archive = await buildLocalCompanionInstaller();
  return new Response(new Uint8Array(archive), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": 'attachment; filename="Joblit-Windows-Setup.zip"',
      "Content-Length": String(archive.length),
      "Cache-Control": "public, max-age=300",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
