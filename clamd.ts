'use strict';

import { Buffer } from 'buffer';
import net from 'net';
import { Readable, Transform } from 'stream';

interface Scanner {
  scanStream: typeof scanStream;
  scanBuffer: typeof scanBuffer;
}

function createScanner(host: string, port: number): Scanner {
  if (!host || !port) {
    throw new Error('Must provide the host and port that clamav server listens to');
  }

  function scanStream(readStream: Readable, timeout = 5000): Promise<string> {
    return new Promise((resolve, reject) => {
      let readFinished = false;

      const socket = net.createConnection({ host, port }, () => {
        socket.write('zINSTREAM\0');
        readStream.pipe(chunkTransform()).pipe(socket);
        readStream
          .on('end', () => {
            readFinished = true;
            readStream.destroy();
          })
          .on('error', reject);
      });

      const replies: Buffer[] = [];
      socket.setTimeout(timeout);

      socket
        .on('data', (chunk) => {
          if (!readStream.isPaused()) {
            readStream.pause();
          }
          replies.push(chunk);
        })
        .on('end', () => {
          const reply = Buffer.concat(replies);
          if (!readFinished) {
            reject(new Error('Scan aborted. Reply from server: ' + reply));
          } else {
            resolve(reply.toString());
          }
        })
        .on('error', reject);
    });
  }

  function scanBuffer(buffer: Buffer, timeout = 5000, chunkSize = 64 * 1024): Promise<string> {
    let start = 0;
    const bufReader = new Readable({
      highWaterMark: chunkSize,
      read(size) {
        if (start < buffer.length) {
          const block = buffer.slice(start, start + size);
          this.push(block);
          start += block.length;
        } else {
          this.push(null);
        }
      },
    });
    return scanStream(bufReader, timeout);
  }

  return {
    scanStream,
    scanBuffer,
