import { Buffer } from 'buffer';
import net from 'net';
import { Readable } from 'stream';

interface Scanner {
  scanStream: (readStream: Readable, timeout?: number) => Promise<string>;
  scanBuffer: (buffer: Buffer, timeout?: number, chunkSize?: number) => Promise<string>;
}

function createScanner(host: string, port: number): Scanner {
  if (!host || !port) {
    throw new Error('Must provide the host and port that ClamAV server listens to');
  }

  function scanStream(readStream: Readable, timeout = 5000): Promise<string> {
    return new Promise((resolve, reject) => {
      const socket = net.createConnection({ host, port }, () => {
        socket.write('zINSTREAM\0');

        const chunkTransform = (): NodeJS.ReadWriteStream => {
          return new Transform({
            transform(chunk, encoding, callback) {
              socket.pause();
              socket.write(chunk, encoding, () => {
                socket.resume();
                callback();
              });
            },
          });
        };

        readStream.pipe(chunkTransform()).pipe(socket);

        readStream.on('end', () => {
          socket.end();
        });

        readStream.on('error', (error) => {
          reject(error);
          socket.end();
        });
      });

      const replies: Buffer[] = [];
      socket.setTimeout(timeout);

      socket.on('data', (chunk) => {
        replies.push(chunk);
      });

      socket.on('end', () => {
        const reply = Buffer.concat(replies);
        resolve(reply.toString());
      });

      socket.on('error', (error) => {
        reject(error);
      });
    });
  }

  function scanBuffer(buffer: Buffer, timeout = 5000, chunkSize = 64 * 1024): Promise<string> {
    const readStream = new Readable({
      read(size) {
        const block = buffer.slice(this.start, this.start + size);
        this.push(block.length > 0 ? block : null);
        this.start += block.length;
      },
    });
    readStream.start = 0;

    return scanStream(readStream, timeout);
  }

  return {
    scanStream,
    scanBuffer,
  };
}
