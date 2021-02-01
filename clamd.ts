'use strict';

/**
 * Module dependencies.
 */

import { Buffer } from 'buffer';
import net = require('net');
import { Readable, Transform } from 'stream';

/**
 * Module exports.
 */

export {
  createScanner,
  ping,
  version,
  isCleanReply,
};

/**
 * Create a scanner
 *
 * @param {string} host clamav server's host
 * @param {number} port clamav sever's port
 * @return {object}
 * @public
 */

function createScanner(host: string, port: number): {
    scanStream: typeof scanStream;
    scanBuffer: typeof scanBuffer;
} {
  if (!host || !port) { throw new Error('must provide the host and port that clamav server listen to'); }

  /**
   * scan a read stream
   * @param {object} readStream
   * @param {number} [timeout = 5000] the socket's timeout option
   * @return {Promise}
   */

  function scanStream(readStream: Readable, timeout?: number): Promise<string> {
    if (typeof timeout === 'undefined' || timeout < 0) { timeout = 5000; }

    // tslint:disable: only-arrow-functions
    return new Promise(function(resolve, reject) {
      let readFinished = false;

      const socket = net.createConnection({
        host,
        port,
      }, function() {
        socket.write('zINSTREAM\0');
        // fotmat the chunk
        readStream.pipe(chunkTransform()).pipe(socket);
        readStream
          .on('end', function() {
            readFinished = true;
            readStream.destroy();
          })
          .on('error', reject);
      });

      const replies: Array<Buffer> = [];
      socket.setTimeout(timeout as number);
      socket
        .on('data', function(chunk) {
          // clearTimeout(connectAttemptTimer);
          if (!readStream.isPaused()) { readStream.pause(); }
          replies.push(chunk);
        })
        .on('end', function() {
          // clearTimeout(connectAttemptTimer);
          const reply = Buffer.concat(replies);
          if (!readFinished) { reject(new Error('Scan aborted. Reply from server: ' + reply)); } else { resolve(reply.toString()); }
        })
        .on('error', reject);

      // const connectAttemptTimer = setTimeout(function() {
      //   socket.destroy(new Error('Timeout connecting to server'));
      // }, timeout);
    });
  }

  /**
   * scan a Buffer
   * @param {string} path
   * @param {number} [timeout = 5000] the socket's timeout option
   * @param {number} [chunkSize = 64kb] size of the chunk, which send to Clamav server
   * @return {Promise}
   */

  function scanBuffer(buffer: Buffer, timeout?: number, chunkSize?: number): Promise<string> {
    if (typeof timeout !== 'number' || timeout < 0) { timeout = 5000; }
    if (typeof chunkSize !== 'number') { chunkSize = 64 * 1024; }

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
  };
}

/**
 * Check the daemon’s state
 *
 * @param {string} host clamav server's host
 * @param {number} port clamav sever's port
 * @param {number} [timeout = 5000] the socket's timeout option
 * @return {boolean}
 * @public
 */

async function ping(host: string, port: number, timeout: number): Promise<boolean> {
  if (!host || !port) { throw new Error('must provide the host and port that clamav server listen to'); }
  if (typeof timeout !== 'number' || timeout < 0) { timeout = 5000; }

  const res = await _command(host, port, timeout, 'zPING\0');

  return res.equals(Buffer.from('PONG\0'));
}

/**
 * Get clamav version detail.
 *
 * @param {string} host clamav server's host
 * @param {number} port clamav sever's port
 * @param {number} [timeout = 5000] pass to sets the socket's timeout optine
 * @return {string}
 * @public
 */

async function version(host: string, port: number, timeout: number): Promise<string> {
  if (!host || !port) { throw new Error('must provide the host and port that clamav server listen to'); }
  if (typeof timeout !== 'number' || timeout < 0) { timeout = 5000; }

  const res = await _command(host, port, timeout, 'zVERSION\0');

  return res.toString();
}

/**
 * Check the reply mean the file infect or not
 *
 * @param {*} reply get from the scanner
 * @return {boolean}
 * @public
 */

function isCleanReply(reply: any): boolean {
  return reply.includes('OK') && !reply.includes('FOUND');
}

/**
 * transform the chunk from read stream to the fotmat that clamav server expect
 *
 * @return {object} stream.Transform
 */
function chunkTransform(): Transform {
  return new Transform(
    {
      transform(chunk, encoding, callback) {
        const length = Buffer.alloc(4);
        length.writeUInt32BE(chunk.length, 0);
        this.push(length);
        this.push(chunk);
        callback();
      },

      flush(callback) {
        const zore = Buffer.alloc(4);
        zore.writeUInt32BE(0, 0);
        this.push(zore);
        callback();
      },
    });
}

/**
 * helper function for single command function like ping() and version()
 * @param {string} host
 * @param {number} port
 * @param {number} timeout
 * @param {string} command will send to clamav server, either 'zPING\0' or 'zVERSION\0'
 */
function _command(host: string, port: number, timeout: number, command: string): Promise<Buffer> {
  return new Promise(function(resolve, reject) {
    const client = net.createConnection({
      host,
      port,
    }, function() {
      client.write(command);
    });
    client.setTimeout(timeout);
    const replies: Array<Buffer> = [];
    client
      .on('data', function(chunk) {
        replies.push(chunk);
      })
      .on('end', function() {
        resolve(Buffer.concat(replies));
      })
      .on('error', reject);
  });
}
