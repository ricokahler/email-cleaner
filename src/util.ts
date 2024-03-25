import zlib from 'node:zlib';

export function bufferToGzipBase64(buffer: Buffer) {
  return new Promise<string>((resolve, reject) => {
    zlib.gzip(buffer, (err, compressed) => {
      if (err) {
        reject(err);
      } else {
        const base64String = compressed.toString('base64');
        resolve(base64String);
      }
    });
  });
}

export function gzipBase64ToBuffer(base64String: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const buffer = Buffer.from(base64String, 'base64');
    zlib.gunzip(buffer, (err, decompressed) => {
      if (err) {
        reject(err);
      } else {
        resolve(decompressed);
      }
    });
  });
}
