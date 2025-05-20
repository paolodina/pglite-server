import * as net from 'node:net';
import { PGlite } from '@electric-sql/pglite';

declare enum LogLevel {
    Error = 0,
    Warn = 1,
    Info = 2,
    Debug = 3
}

type ServerOptions = net.ServerOpts & {
    logLevel: LogLevel;
};
declare function createServer(db: PGlite, options?: Partial<ServerOptions>): net.Server;

export { LogLevel, createServer };
