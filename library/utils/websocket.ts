import EventEmitter from "events";
import { ClientRequestArgs } from "http";
import { ClientOptions, RawData, WebSocket } from "ws";

export type Options = {
    address: () => PromiseLike<string>;
    protocols?: string | string[];
    options?: ClientOptions | ClientRequestArgs;
    closeCodes?: number[];
    heartbeat?: number;
    message?: {
        transform?: (payload: any) => PromiseLike<any>;
        encode?: (payload: any) => PromiseLike<any>;
        decode?: (message: any) => PromiseLike<any>;
        identify?: (payload: any, message: any) => PromiseLike<boolean>;
    };
};

const DefaultOptions = {
    closeCodes: [1000, 1005, 1006],
    heartbeat: 0,
    message: {
        transform: async (payload: any) => payload,
        encode: async (payload: any) => payload,
        decode: async (message: any) => message,
        identify: async () => true
    }
};

export class ReconnectSocket extends EventEmitter {
    #websocket?: WebSocket;
    #connectionPromise?: Promise<void>;
    #heartbeatTimeout?: NodeJS.Timeout;
    #reconnectTimeout?: NodeJS.Timeout;
    #reconnectAttempt: number = 0;

    constructor(public options: Options) {
        super();
    }

    async connect(timeoutSec: number = 10) {
        if (this.#connectionPromise) return this.#connectionPromise;

        this.#connectionPromise = (async () => {
            try {
                const address = await this.options.address();
                const { protocols, options } = this.options;

                await new Promise<void>((resolve, reject) => {
                    this.#websocket = new WebSocket(address, protocols, options);
                    this.#websocket.on("ping", () => this.#heartbeat());
                    this.#websocket.on("error", console.error);
                    
                    this.#websocket.once("open", async () => {
                        this.#reconnectAttempt = 0;
                        this.#heartbeat();
                        this.emit("connect");
                        resolve();
                    });

                    this.#websocket.on("close", async (code, reason) => {
                        if (this.#reconnectAttempt === 0) {
                            this.emit("disconnect");
                            return reject("Ошибка подключения");
                        }

                        const closeCodes = this.options.closeCodes ?? DefaultOptions.closeCodes;
                        if (this.#reconnectAttempt > 3 || closeCodes.includes(code)) {
                            this.#cleanup();
                            this.emit("disconnect");
                        }
                        await this.#reconnect();
                    });

                    this.#websocket.on("message", async (message) => {
                        this.#heartbeat();
                        
                        // Декодируем сообщение или возвращаем оригинал
                        const decode = this.options.message?.decode ?? DefaultOptions.message.decode;
                        await decode(message)
                            .then(decoded => this.emit("message", decoded), console.error);
                    });

                    setTimeout(() => reject(new Error("Таймаут подключения")), timeoutSec * 1000);
                });
            } finally {
                this.#connectionPromise = undefined;
            }
        })();

        return this.#connectionPromise.catch(error => {
            this.#cleanup();
            return Promise.reject(error);
        });
    }

    async disconnect() {
        return new Promise<void>(resolve => {
            if (!this.#websocket) return resolve();
            this.#websocket.once("close", resolve);
            this.#websocket.close(1000);
        });
    }

    async send(payload: any, timeoutSec: number = 10) {
        return new Promise<any>(async (resolve, reject) => {
            await this.connect().then(undefined, reject);

            const transform = this.options.message?.transform ?? DefaultOptions.message.transform;
            const encode = this.options.message?.encode ?? DefaultOptions.message.encode;
            const decode = this.options.message?.decode ?? DefaultOptions.message.decode;
            const identify = this.options.message?.identify ?? DefaultOptions.message.identify;

            const transformed = await transform(payload).then(undefined, reject);
            const encoded = await encode(transformed).then(undefined, reject);

            async function handleMessage(this: WebSocket, message: RawData) {
                const decoded = await decode(message).then(undefined, reject);
                const isValid = await identify(transformed, decoded).then(undefined, reject);
                if (!isValid) return;
                
                resolve(decoded);
                this.off("message", handleMessage);
            }

            this.#websocket!.on("message", handleMessage);
            this.#websocket!.send(encoded);
            setTimeout(() => reject(new Error("Таймаут отправки")), timeoutSec * 1000);
        });
    }

    #heartbeat() {
        const timeoutSec = this.options.heartbeat ?? DefaultOptions.heartbeat;
        if (timeoutSec <= 0) return;

        clearTimeout(this.#heartbeatTimeout);
        this.#heartbeatTimeout =
            setTimeout(async () => await this.#reconnect().catch(console.error), timeoutSec * 1000);
    }

    async #reconnect() {
        clearTimeout(this.#reconnectTimeout);
        const delay = Math.min(1000 * Math.pow(2, this.#reconnectAttempt - 1), 30000);
        const jitter = Math.random() * 1000;
        
        this.#reconnectAttempt += 1;
        this.#reconnectTimeout =
            setTimeout(async () => await this.connect().catch(console.error), delay + jitter);
    }

    #cleanup() {
        if (this.#websocket) {
            this.#websocket.removeAllListeners();
            this.#websocket = undefined;
        }
        clearTimeout(this.#heartbeatTimeout);
        clearTimeout(this.#reconnectTimeout);
    }
}