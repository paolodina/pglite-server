// src/server.ts
import * as net from "net";

// src/messages.ts
var IDENT_LENGTH = 1;
var IDENT_TO_MESSAGE_NAME = {
  ["B".charCodeAt(0)]: "Bind",
  ["C".charCodeAt(0)]: "Close",
  ["f".charCodeAt(0)]: "CopyFail",
  ["D".charCodeAt(0)]: "Describe",
  ["E".charCodeAt(0)]: "Execute",
  ["H".charCodeAt(0)]: "Flush",
  ["F".charCodeAt(0)]: "FunctionCall",
  ["p".charCodeAt(0)]: "GSSResponse",
  ["P".charCodeAt(0)]: "Parse",
  ["p".charCodeAt(0)]: "PasswordMessage",
  ["Q".charCodeAt(0)]: "Query",
  ["p".charCodeAt(0)]: "SASLResponse",
  ["S".charCodeAt(0)]: "Sync",
  ["X".charCodeAt(0)]: "Terminate"
};
var UNKNOWN_MESSAGE = {
  name: "Unknown",
  length: 0,
  buffer: Buffer.alloc(0)
};
var INSUFFICIENT_DATA = {
  name: "Unknown",
  length: 0,
  buffer: Buffer.alloc(0)
};
function isCancelRequest(buffer) {
  return buffer.at(4) === 4 && buffer.at(5) === 210 && buffer.at(6) === 22 && buffer.at(7) === 46;
}
function isGSSENCRequest(buffer) {
  return buffer.at(4) === 4 && buffer.at(5) === 210 && buffer.at(6) === 22 && buffer.at(7) === 48;
}
function isSSLRequest(buffer) {
  return buffer.at(4) === 4 && buffer.at(5) === 210 && buffer.at(6) === 22 && buffer.at(7) === 47;
}
function isStartupMessage(buffer) {
  return buffer.at(4) === 0 && buffer.at(5) === 3 && buffer.at(6) === 0 && buffer.at(7) === 0;
}
function parseMessage(buffer) {
  if (buffer.length === 0) {
    return INSUFFICIENT_DATA;
  }
  if (isCancelRequest(buffer)) {
    const length2 = buffer.readUint32BE(0);
    return {
      name: "CancelRequest",
      length: length2,
      buffer: Buffer.from(buffer.subarray(0, length2))
    };
  }
  if (isGSSENCRequest(buffer)) {
    const length2 = buffer.readUint32BE(0);
    return {
      name: "GSSENCRequest",
      length: length2,
      buffer: Buffer.from(buffer.subarray(0, length2))
    };
  }
  if (isSSLRequest(buffer)) {
    const length2 = buffer.readUint32BE(0);
    return {
      name: "SSLRequest",
      length: length2,
      buffer: Buffer.from(buffer.subarray(0, length2))
    };
  }
  if (isStartupMessage(buffer)) {
    const length2 = buffer.readUint32BE(0);
    return {
      name: "StartupMessage",
      length: length2,
      buffer: Buffer.from(buffer.subarray(0, length2))
    };
  }
  const name = IDENT_TO_MESSAGE_NAME[buffer.at(0)];
  if (!name) {
    return UNKNOWN_MESSAGE;
  }
  const length = buffer.readUint32BE(1) + IDENT_LENGTH;
  if (buffer.length < length) {
    return INSUFFICIENT_DATA;
  }
  return {
    name,
    length,
    buffer: Buffer.from(buffer.subarray(0, length))
  };
}

// src/write-buffer.ts
var GrowableOffsetBuffer = class {
  #buffer = Buffer.alloc(16);
  #offset = 0;
  write(data) {
    this.updateCapacity(data.length);
    this.#buffer.write(data, this.#offset);
    this.#offset += data.length;
  }
  writeUint8(data) {
    this.updateCapacity(1);
    this.#buffer.writeUint8(data, this.#offset);
    this.#offset += 1;
  }
  writeUint32BE(data) {
    this.updateCapacity(4);
    this.#buffer.writeUint32BE(data, this.#offset);
    this.#offset += 4;
  }
  updateCapacity(chunkLength) {
    while (this.#buffer.byteLength < this.#offset + chunkLength) {
      const newBuffer = Buffer.alloc(this.#buffer.byteLength * 2);
      this.#buffer.copy(newBuffer, 0, 0, this.#offset);
      this.#buffer = newBuffer;
    }
  }
  toBuffer() {
    return Buffer.from(this.#buffer.subarray(0, this.#offset));
  }
};

// src/responses.ts
function createCancelRequest() {
  return new GrowableOffsetBuffer().toBuffer();
}
function createGSSENCRequest() {
  return new GrowableOffsetBuffer().toBuffer();
}
function createSSLRequestReponse() {
  const sslNegotiation = new GrowableOffsetBuffer();
  sslNegotiation.write("N");
  return sslNegotiation.toBuffer();
}
function createStartupMessageReponse() {
  const authOk = new GrowableOffsetBuffer();
  authOk.write("R");
  authOk.writeUint32BE(8);
  authOk.writeUint32BE(0);
  const parameterStatus = new GrowableOffsetBuffer();
  const paramKey = "server_version";
  const paramValue = "15.0";
  parameterStatus.write("S");
  parameterStatus.writeUint32BE(6 + paramKey.length + paramValue.length);
  parameterStatus.write(paramKey);
  parameterStatus.writeUint8(0);
  parameterStatus.write(paramValue);
  parameterStatus.writeUint8(0);
  const backendKeyData = new GrowableOffsetBuffer();
  backendKeyData.write("K");
  backendKeyData.writeUint32BE(12);
  backendKeyData.writeUint32BE(1);
  backendKeyData.writeUint32BE(2);
  const readyForQuery = new GrowableOffsetBuffer();
  readyForQuery.write("Z");
  readyForQuery.writeUint32BE(5);
  readyForQuery.write("I");
  return Buffer.concat([
    authOk.toBuffer(),
    parameterStatus.toBuffer(),
    backendKeyData.toBuffer(),
    readyForQuery.toBuffer()
  ]);
}
function createErrorReponse(message) {
  const errorResponse = new GrowableOffsetBuffer();
  errorResponse.write("E");
  errorResponse.writeUint32BE(7 + message.length);
  errorResponse.write("M");
  errorResponse.write(message);
  errorResponse.writeUint8(0);
  errorResponse.writeUint8(0);
  const readyForQuery = new GrowableOffsetBuffer();
  readyForQuery.write("Z");
  readyForQuery.writeUint32BE(5);
  readyForQuery.write("I");
  return Buffer.concat([errorResponse.toBuffer(), readyForQuery.toBuffer()]);
}
async function createMessageResponse(message, db) {
  switch (message.name) {
    case "CancelRequest": {
      return createCancelRequest();
    }
    case "GSSENCRequest": {
      return createGSSENCRequest();
    }
    case "SSLRequest": {
      return createSSLRequestReponse();
    }
    case "StartupMessage": {
      return createStartupMessageReponse();
    }
    default: {
      try {
        const result = await db.execProtocol(message.buffer);
        return Buffer.from(result.data);
      } catch (e) {
        const message2 = e instanceof Error ? e.message : "Unknown error message";
        return createErrorReponse(message2);
      }
    }
  }
}

// src/logger.ts
var LogLevel = /* @__PURE__ */ ((LogLevel2) => {
  LogLevel2[LogLevel2["Error"] = 0] = "Error";
  LogLevel2[LogLevel2["Warn"] = 1] = "Warn";
  LogLevel2[LogLevel2["Info"] = 2] = "Info";
  LogLevel2[LogLevel2["Debug"] = 3] = "Debug";
  return LogLevel2;
})(LogLevel || {});
var Logger = class {
  constructor(logLevel = 2 /* Info */, prefix) {
    this.logLevel = logLevel;
    this.prefix = `[${prefix}]:`;
  }
  prefix;
  debug(...data) {
    if (this.logLevel < 3 /* Debug */) return;
    console.debug(this.prefix, ...data);
  }
  info(...data) {
    if (this.logLevel < 2 /* Info */) return;
    console.info(this.prefix, ...data);
  }
  warn(...data) {
    if (this.logLevel < 1 /* Warn */) return;
    console.warn(this.prefix, ...data);
  }
  error(...data) {
    console.error(this.prefix, ...data);
  }
};

// src/server.ts
function createServer2(db, options = { logLevel: 2 /* Info */ }) {
  const server = net.createServer(options);
  server.on("connection", function(socket) {
    let clientBuffer = Buffer.allocUnsafe(0);
    const clientAddr = `${socket.remoteAddress}:${socket.remotePort}`;
    const logger = new Logger(options.logLevel, clientAddr);
    logger.info(`Client connected`);
    socket.on("data", async (data) => {
      clientBuffer = Buffer.concat([clientBuffer, data]);
      while (clientBuffer.length > 0) {
        const message = parseMessage(clientBuffer);
        logger.debug(`${"-".repeat(42)}
`);
        logger.debug(`> Current buffer`);
        logger.debug(`> Length: ${clientBuffer.length}`);
        logger.debug(`> Raw:`, clientBuffer);
        logger.debug(`> Text: ${clientBuffer.toString()}`);
        logger.debug(``);
        logger.debug(`>> Message name: ${message.name}`);
        logger.debug(`>> Message length: ${message.length}`);
        logger.debug(`>> Message buffer raw:`, message.buffer);
        logger.debug(`>> Message buffer text: ${message.buffer.toString()}`);
        logger.debug(``);
        if (message.name === "InsufficientData") {
          continue;
        }
        if (message.name === "Unknown" || message.name === "Terminate") {
          socket.end();
          return;
        }
        const response = await createMessageResponse(message, db);
        socket.write(response);
        clientBuffer = Buffer.from(clientBuffer.subarray(message.length));
        logger.debug(`> Remaining buffer`);
        logger.debug(`> Length: ${clientBuffer.length}`);
        logger.debug(`> Raw:`, clientBuffer);
        logger.debug(`> Text: ${clientBuffer.toString() || "<empty>"}`);
        logger.debug(``);
      }
    });
    socket.on("end", () => {
      logger.info(`Client disconnected`);
    });
    socket.on("error", (err) => {
      logger.error(`Client error:`, err);
      socket.end();
    });
  });
  server.on("error", (err) => {
    throw err;
  });
  return server;
}
export {
  LogLevel,
  createServer2 as createServer
};
