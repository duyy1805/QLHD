import { Readable } from "stream";
import { google } from "googleapis";

const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive";

function getRequiredEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Thi\u1ebfu c\u1ea5u h\u00ecnh ${name}.`);
  return value;
}

function getPrivateKey() {
  return getRequiredEnv("GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY").replace(/\\n/g, "\n");
}

export function getDriveClient() {
  if (process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE) {
    const auth = new google.auth.GoogleAuth({
      keyFile: process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE,
      scopes: [DRIVE_SCOPE],
    });

    return google.drive({ version: "v3", auth });
  }

  const auth = new google.auth.JWT({
    email: getRequiredEnv("GOOGLE_SERVICE_ACCOUNT_EMAIL"),
    key: getPrivateKey(),
    scopes: [DRIVE_SCOPE],
  });

  return google.drive({ version: "v3", auth });
}

export async function uploadFileToDrive(file: File, storedName: string) {
  const drive = getDriveClient();
  const folderId = getRequiredEnv("GOOGLE_DRIVE_FOLDER_ID");
  const bytes = Buffer.from(await file.arrayBuffer());

  const response = await drive.files.create({
    requestBody: {
      name: storedName,
      parents: [folderId],
    },
    media: {
      mimeType: file.type || "application/octet-stream",
      body: Readable.from(bytes),
    },
    fields: "id, name, mimeType, webViewLink, webContentLink",
    supportsAllDrives: true,
  });

  if (!response.data.id) throw new Error("Kh\u00f4ng l\u1ea5y \u0111\u01b0\u1ee3c m\u00e3 file t\u1eeb Google Drive.");
  return response.data.id;
}