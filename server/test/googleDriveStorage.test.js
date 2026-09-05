/* global require */
const test = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('stream');
const {
    deleteDriveFileByPath,
    getDriveFileStream,
    parseDriveFileId,
    toDrivePath,
    uploadBufferToInvoiceDrive,
} = require('../utils/googleDriveStorage');

test('drive path round trip', () => {
    assert.equal(toDrivePath('abc-123'), 'drive:abc-123');
    assert.equal(parseDriveFileId('drive:abc-123'), 'abc-123');
    assert.equal(parseDriveFileId('C:/legacy/file.pdf'), null);
});

test('uploads a buffer to the configured invoice folder', async () => {
    const previousFolderId = process.env.HD_GOOGLE_DRIVE_FOLDER_ID;
    process.env.HD_GOOGLE_DRIVE_FOLDER_ID = 'invoice-folder';
    let request;
    const drive = {
        files: {
            create: async (input) => {
                request = input;
                return { data: { id: 'file-1', name: input.requestBody.name, mimeType: input.media.mimeType, size: '3' } };
            },
        },
    };

    try {
        const result = await uploadBufferToInvoiceDrive({
            buffer: Buffer.from('abc'),
            storedName: 'invoice.pdf',
            mimeType: 'application/pdf',
        }, drive);
        assert.equal(result.filePath, 'drive:file-1');
        assert.deepEqual(request.requestBody.parents, ['invoice-folder']);
        assert.equal(request.media.mimeType, 'application/pdf');
    } finally {
        if (previousFolderId === undefined) delete process.env.HD_GOOGLE_DRIVE_FOLDER_ID;
        else process.env.HD_GOOGLE_DRIVE_FOLDER_ID = previousFolderId;
    }
});

test('streams metadata and content through the Drive client', async () => {
    const content = Readable.from(Buffer.from('content'));
    const drive = {
        files: {
            get: async (input, options) => options?.responseType === 'stream'
                ? { data: content }
                : { data: { name: 'invoice.pdf', mimeType: 'application/pdf', size: '7' } },
        },
    };
    const result = await getDriveFileStream('drive:file-2', drive);
    assert.equal(result.metadata.name, 'invoice.pdf');
    assert.equal(result.stream, content);
});

test('deleting a missing Drive file is idempotent', async () => {
    const drive = {
        files: {
            delete: async () => {
                const error = new Error('not found');
                error.response = { status: 404 };
                throw error;
            },
        },
    };
    await assert.doesNotReject(() => deleteDriveFileByPath('drive:missing', drive));
});

test('propagates non-404 Drive deletion failures', async () => {
    const drive = {
        files: {
            delete: async () => {
                const error = new Error('unavailable');
                error.response = { status: 503 };
                throw error;
            },
        },
    };
    await assert.rejects(() => deleteDriveFileByPath('drive:file-3', drive), /unavailable/);
});
