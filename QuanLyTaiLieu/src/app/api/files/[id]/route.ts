import { Readable } from "stream";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getDriveClient } from "@/lib/google-drive";

export const runtime = "nodejs";

function encodeFileName(name: string) {
  return encodeURIComponent(name).replace(/['()]/g, escape);
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSession();
  if (!user) return NextResponse.json({ message: "Bạn chưa đăng nhập." }, { status: 401 });

  const { id } = await params;
  const drive = getDriveClient();

  const metadata = await drive.files.get({
    fileId: id,
    fields: "name,mimeType,size",
    supportsAllDrives: true,
  });

  const file = await drive.files.get(
    {
      fileId: id,
      alt: "media",
      supportsAllDrives: true,
    },
    { responseType: "stream" },
  );

  const fileName = metadata.data.name || "download";
  const mimeType = metadata.data.mimeType || "application/octet-stream";
  const headers = new Headers({
    "Content-Type": mimeType,
    "Content-Disposition": `inline; filename*=UTF-8''${encodeFileName(fileName)}`,
    "Cache-Control": "private, max-age=60",
  });

  if (metadata.data.size) {
    headers.set("Content-Length", metadata.data.size);
  }

  const body = Readable.toWeb(file.data as unknown as Readable) as ReadableStream;
  return new Response(body, { headers });
}
