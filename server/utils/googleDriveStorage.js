/* global require, Buffer, process, module */
const { Readable } = require('stream');
const { google } = require('googleapis');

const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive';
const DRIVE_PATH_PREFIX = 'drive:';

function getRequiredEnv(name) {
    const value = process.env[name];
    if (!value) throw new Error(`Thiếu cấu hình ${name}.`);
    return value;
}

function getPrivateKey() {
    return getRequiredEnv('GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY').replace(/\\n/g, '\n');
}

function getDriveClient() {
    if (process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE) {
        const auth = new google.auth.GoogleAuth({
            keyFile: process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE,
            scopes: [DRIVE_SCOPE],
        });
        return google.drive({ version: 'v3', auth });
    }

    const auth = new google.auth.JWT({
        email: getRequiredEnv('GOOGLE_SERVICE_ACCOUNT_EMAIL'),
        key: getPrivateKey(),
        scopes: [DRIVE_SCOPE],
    });
    return google.drive({ version: 'v3', auth });
}

function toDrivePath(fileId) {
    return `${DRIVE_PATH_PREFIX}${fileId}`;
}

function parseDriveFileId(filePath) {
    if (typeof filePath !== 'string' || !filePath.startsWith(DRIVE_PATH_PREFIX)) return null;
    return filePath.slice(DRIVE_PATH_PREFIX.length).trim() || null;
}

async function uploadBufferToInvoiceDrive({ buffer, storedName, mimeType }, drive = getDriveClient()) {
    const folderId = getRequiredEnv('HD_GOOGLE_DRIVE_FOLDER_ID');
    const response = await drive.files.create({
        requestBody: { name: storedName, parents: [folderId] },
        media: {
            mimeType: mimeType || 'application/octet-stream',
            body: Readable.from(buffer),
        },
        fields: 'id,name,mimeType,size',
        supportsAllDrives: true,
    });
    if (!response.data.id) throw new Error('Không lấy được mã file từ Google Drive.');
    return {
        fileId: response.data.id,
        filePath: toDrivePath(response.data.id),
        name: response.data.name,
        mimeType: response.data.mimeType,
        size: response.data.size,
    };
}

async function getDriveFileStream(filePath, drive = getDriveClient()) {
    const fileId = parseDriveFileId(filePath);
    if (!fileId) throw new Error('Không xác định được file Google Drive.');
    const metadata = await drive.files.get({
        fileId,
        fields: 'name,mimeType,size',
        supportsAllDrives: true,
    });
    const media = await drive.files.get(
        { fileId, alt: 'media', supportsAllDrives: true },
        { responseType: 'stream' }
    );
    return { metadata: metadata.data, stream: media.data };
}

async function deleteDriveFileByPath(filePath, drive = getDriveClient()) {
    const fileId = parseDriveFileId(filePath);
    if (!fileId) throw new Error('Không xác định được file Google Drive cần xóa.');
    try {
        await drive.files.delete({ fileId, supportsAllDrives: true });
    } catch (error) {
        if (error?.response?.status === 404 || error?.code === 404) return;
        throw error;
    }
}

module.exports = {
    deleteDriveFileByPath,
    getDriveClient,
    getDriveFileStream,
    parseDriveFileId,
    toDrivePath,
    uploadBufferToInvoiceDrive,
};
