import { Transform, TransformCallback, TransformOptions } from "stream";

export class ClamTransform extends Transform {
	private _streaming: boolean;
	private _numChunks: number;
	private _totalSize: number;
	/**
	 * Creates a new instance of NodeClamTransform.
	 *
	 * @param options - Optional overrides to defaults (same as Node.js Transform)
	 */
	constructor(options?: TransformOptions) {
		super(options);
		this._streaming = false;
		this._numChunks = 0;
		this._totalSize = 0;
	}

	/**
	 * Actually transforms the data for ClamAV.
	 *
	 * @param chunk - The piece of data to push onto the stream
	 * @param encoding - The encoding of the chunk
	 * @param callback - What to do when done pushing chunk
	 */
	_transform(
		chunk: Buffer,
		encoding: BufferEncoding,
		callback: TransformCallback
	): void {
		if (!this._streaming) {
			this.push("zINSTREAM\0");
			this._streaming = true;
		}

		this._totalSize += chunk.length;

		const size = Buffer.alloc(4);
		size.writeInt32BE(chunk.length, 0);
		this.push(size);
		this.push(chunk);

		this._numChunks += 1;
		callback();
	}

	/**
	 * Flushes out the stream when all data has been received.
	 *
	 * @param callback - What to do when done
	 */
	_flush(callback: TransformCallback): void {

		const rState = (this as any)._readableState;
		if (rState && !rState.ended) {
			const size = Buffer.alloc(4);
			size.writeInt32BE(0, 0);
			this.push(size);
		}
		callback();
	}
}
