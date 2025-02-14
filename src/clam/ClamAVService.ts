import * as net from "net";
import { PassThrough, Readable } from "stream";
import { ClamTransform } from "./ClamTransform";
import { ILogger } from "@rocket.chat/apps-engine/definition/accessors";

interface ClamScanSettings {
	logger?: ILogger;
	port: number;
	host: string;
	timeout?: number;
}

interface ProcessResult {
	isInfected: boolean | null;
	viruses: ( string | null )[];
	file: string | null;
	resultString: string;
	timeout: boolean;
}

export class ClamAVService {
	private debugLabel = "node-clam";

	constructor(private settings: ClamScanSettings, private logger?: ILogger) {
		this.settings = settings;
		this.logger = logger;
	}

	private _processResult(
		result: string,
		file: string | null = null
	): ProcessResult | Error {
		let timeout = false;

		if (typeof result !== "string") {
			this.logger?.error(`${this.debugLabel}: Invalid stdout from scanner (not a string): `, result);
			return new Error("Invalid result to process (not a string)");
		}

		// Clean up the result string so that it's predictably parseable
		result = result.trim();

		// "OK" result example: <FILE>: OK
		if (/:\s+OK(\u0000|[\r\n])?$/.test(result)) {
			return {
				isInfected: false,
				viruses: [],
				file,
				resultString: result,
				timeout,
			};
		}

		// "FOUND" result example: <FILE>: <VIRUS> FOUND
		if (/:\s+(.+)FOUND(\u0000|[\r\n])?/gm.test(result)) {
			this.logger?.log(`${this.debugLabel}: Scan Response: `, result);
			this.logger?.log(`${this.debugLabel}: File is INFECTED!`);

			// Parse out the name of the virus(es) found...
			const viruses = Array.from(
				new Set(
					result
						.split(/(\u0000|[\r\n])/) // split on newline or \0
						.map((v) => {
							// eslint-disable-next-line no-control-regex
							return /:\s+(.+)FOUND$/gm.test(v)
								? v.replace(/(.+:\s+)(.+)FOUND/gm, "$2").trim()
								: null;
						})
						.filter((v) => !!v)
				)
			);

			return {
				isInfected: true,
				viruses,
				file,
				resultString: result,
				timeout,
			};
		}

		// If the result ends with "ERROR", something went wrong
		if (/^(.+)ERROR(\u0000|[\r\n])?/gm.test(result)) {
			const error = result.replace(/^(.+)ERROR/gm, "$1").trim();
			
			this.logger?.error(
				`${this.debugLabel}: Error Response: `,
				error
			);
			this.logger?.error(`${this.debugLabel}: File may be INFECTED!`);

			return new Error(
				`An error occurred while scanning the piped-through stream: ${error}`
			);
		}

		// If we got a timeout
		if (result === "COMMAND READ TIMED OUT") {
			timeout = true;
			this.logger?.error(
				`${this.debugLabel}: Scanning file has timed out. Message: `,
				result
			);
			this.logger?.error(`${this.debugLabel}: File may be INFECTED!`);

			return {
				isInfected: null,
				viruses: [],
				file,
				resultString: result,
				timeout,
			};
		}

		// Fallback case: unknown result
		this.logger?.error(`${this.debugLabel}: Error Response: `, result);
		this.logger?.error(`${this.debugLabel}: File may be INFECTED!`);

		return {
			isInfected: null,
			viruses: [],
			file,
			resultString: result,
			timeout,
		};
	}

	/**
	 * Create a socket connection to a remote (or local) ClamAV daemon.
	 *
	 * @returns A TCP Socket connection to ClamAV
	 */
	private _initSocket(): Promise<net.Socket> {
		return new Promise((resolve, reject) => {
			let client: net.Socket;

			const timeout = this.settings.timeout || 5000;

			// If a port is specified, connect via TCP
			if (this.settings.port && this.settings.host) {
				client = net.createConnection({
					host: this.settings.host,
					port: this.settings.port,
					timeout,
				});
			} else {
				// If we don't have a valid (host, port) combo or socket, error out
				throw new Error(
					"Unable to establish connection to clamd service: No socket or host/port combo provided!"
				);
			}

			// If user set a timeout, apply it to the socket
			if (this.settings.timeout) {
				client.setTimeout(this.settings.timeout);
			}

			client
				.on("connect", () => {
					return resolve(client);
				})
				.on("timeout", () => {
					this.logger?.error(`${this.debugLabel}: Socket/Host connection timed out.`);
					reject(new Error("Connection to host has timed out."));
					client.end();
				})
				.on("error", (e) => {
					this.logger?.error(`${this.debugLabel}: Socket/Host connection failed:`, e);
					reject(e);
				});
		});
	}

	/**
	 * Scans a stream by piping it through ClamAV.
	 *
	 * @param stream - The readable data stream to scan
	 * @param file   - The optional name/path for the file being scanned
	 */
	public scanStream(stream: Readable, file?: string): Promise<ProcessResult> {
		return new Promise<ProcessResult>(async (resolve, reject) => {
			let finished = false;

			// Validate that the required settings are present
			if (
				!this.settings.port &&
				!this.settings.host
			) {
				return reject(
					new Error(
						"Invalid info to connect to clamav service. A unix socket or port (w/ host) is required!"
					)
				);
			}

			let socket: net.Socket;

			try {
				// Our transform that shapes stream data into ClamAV expected input
				const transform = new ClamTransform({});

				// Acquire socket
				socket = await this._initSocket();

				// Pipe the data: (stream) -> (transform) -> (socket)
				transform
					.on("data", (data: Buffer) => {
						socket.write(data);
					})
					.on("error", (err: Error) => {
						this.logger?.error(`${this.debugLabel}: Transform stream error: `, err);
						socket.end();
						return reject(err);
					});

				stream
					.on("data", (data: Buffer) => {
						transform.write(data);
					})
					.on("end", () => {
						finished = true;
						transform.end();
					})
					.on("error", (err: Error) => {
						this.logger?.error(`${this.debugLabel}: Error from input stream (perhaps the uploader closed the browser?)`, err);
						return reject(err);
					});

				// Capture the socket's response
				const chunks: Buffer[] = [];
				socket
					.on("data", (chunk: Buffer) => {
						// We can pause the upstream until we finish reading
						if (!stream.isPaused()) stream.pause();
						chunks.push(chunk);
					})
					.on("close", (hadError: boolean) => {
						socket.end();
						if (hadError) {
							this.logger?.error(`${this.debugLabel}: ClamAV socket closed due to an error.`);
						}
					})
					.on("error", (err: Error) => {
						this.logger?.error(`${this.debugLabel}: Socket error: `, err);
						socket.end();
						transform.destroy();
						return reject(err);
					})
					.on("end", () => {
						socket.destroy();
						transform.destroy();

						const response = Buffer.concat(chunks);

						// If the scan finished too soon, treat as an error
						if (!finished) {
							return reject(new Error(`Scan aborted. Reply from server: ${response.toString("utf8")}`));
						}
						const result = this._processResult(response.toString("utf8"), file);
						if (result instanceof Error) {
							return reject(result);
						}
						return resolve(result);
					});
			} catch (err) {
				return reject(err);
			}
		});
	}

	/**
	 * Scans a buffer
	 * @param buffer 
	 * @param fileName 
	 */
	async scanBuffer(buffer: Buffer, fileName?: string) {
		const stream = new PassThrough();
		stream.end(buffer);

		return this.scanStream(stream, fileName);
	}


	/**
	 * Check the daemon’s state
	 */

	async ping(): Promise<boolean> {
		const res = await this.command('zPING\0');
		return res.equals(Buffer.from('PONG\0'));
	}

	/**
	 * Get clamav version detail.
	 */

	async version(): Promise<string> {
		const res = await this.command('zVERSION\0');

		return res.toString();
	}

	/**
	 * helper function for single command function like ping() and version()
	 * @param command will send to clamav server, either 'zPING\0' or 'zVERSION\0'
	 */
	async command(command: string): Promise<Buffer> {
		const client = await this._initSocket();
		client.write(command);

		return new Promise((resolve, reject) => {
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
}
