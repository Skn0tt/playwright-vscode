/**
 * Copyright (c) Microsoft Corporation.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import path from 'path';
import * as http from 'http';
import WebSocket, { WebSocketServer } from 'ws';
import { ConnectionTransport } from './transport';
import { createGuid } from './utils';
import * as vscodeTypes from './vscodeTypes';
import * as reporterTypes from './upstream/reporter';
import { TeleReporterReceiver } from './upstream/teleReceiver';

abstract class BaseReporterServer {
  private _wsServer: WebSocketServer | undefined;

  async env() {
    const wsEndpoint = await this._listen();
    return {
      PW_TEST_REPORTER: require.resolve('./oopReporter'),
      PW_TEST_REPORTER_WS_ENDPOINT: wsEndpoint,
    };
  }

  private async _listen(): Promise<string> {
    const server = http.createServer((_, response) => response.end());
    server.on('error', error => console.error(error));

    const path = '/' + createGuid();
    const wsEndpoint = await new Promise<string>((resolve, reject) => {
      server.listen(0, () => {
        const address = server.address();
        if (!address) {
          reject(new Error('Could not bind server socket'));
          return;
        }
        const wsEndpoint = typeof address === 'string' ? `${address}${path}` : `ws://127.0.0.1:${address.port}${path}`;
        resolve(wsEndpoint);
      }).on('error', reject);
    });

    const wsServer = new WebSocketServer({ server, path });
    wsServer.on('connection', socket => {
      const transport: ConnectionTransport = {
        send: function(message): void {
          if (socket.readyState !== WebSocket.CLOSING)
            socket.send(JSON.stringify(message));
        },

        isClosed() {
          return socket.readyState === WebSocket.CLOSED || socket.readyState === WebSocket.CLOSING;
        },

        close: () => {
          socket.close();
        }
      };

      socket.on('message', (message: string) => {
        transport.onmessage?.(JSON.parse(Buffer.from(message).toString()));
      });
      socket.on('close', () => {
        transport.onclose?.();
      });
      socket.on('error', () => {
        transport.onclose?.();
      });

      this.onTransport(transport);
    });
    this._wsServer = wsServer;

    return wsEndpoint;
  }

  close() {
    console.trace('Closing reporter server');
    this._wsServer?.close();
  }

  protected abstract onTransport(transport: ConnectionTransport): void;
}

export class TestCLIReporterServer extends BaseReporterServer {
  private _transportPromise: Promise<ConnectionTransport>;
  private _transportCallback!: (socket: ConnectionTransport) => void;

  constructor() {
    super();
    this._transportPromise = new Promise(f => this._transportCallback = f);
  }

  async wireTestListener(listener: reporterTypes.ReporterV2, token: vscodeTypes.CancellationToken) {
    let timeout: NodeJS.Timeout | undefined;
    const transport = await Promise.race([
      this._transportPromise,
      new Promise<'cancellationRequested'>(f => token.onCancellationRequested(() => { this.close(); f('cancellationRequested'); }))
    ]);
    if (transport === 'cancellationRequested')
      return;

    transport.onclose = () => {
      this.close();
    };

    const killTestProcess = () => {
      if (!transport.isClosed()) {
        try {
          transport.send({ id: 0, method: 'stop', params: {} });
          timeout = setTimeout(() => transport.close(), 30000);
        } catch {
          // Close in case we are getting an error or close is racing back from remote.
          transport.close();
        }
      }
    };

    token.onCancellationRequested(killTestProcess);
    if (token.isCancellationRequested)
      killTestProcess();

    const teleReceiver = new TeleReporterReceiver(listener, {
      mergeProjects: true,
      mergeTestCases: true,
      resolvePath: (rootDir: string, relativePath: string) => path.join(rootDir, relativePath),
    });

    transport.onmessage = message => {
      if (token.isCancellationRequested && message.method !== 'onEnd')
        return;
      if (message.method === 'onEnd')
        transport.close();
      void teleReceiver.dispatch(message as any);
    };

    await new Promise<void>(f => transport.onclose = f);
    if (timeout)
      clearTimeout(timeout);
  }

  protected onTransport(transport: ConnectionTransport): void {
    this._transportCallback(transport);
  }
}

export class TerminalReporterServer {
  private _wsServer: WebSocketServer | undefined;

  constructor(
    private readonly _onTerminalRunStart: () => { listener: reporterTypes.ReporterV2, onClose(): void } | undefined
  ) {
  }

  async env() {
    const wsEndpoint = await this._listen();
    return {
      PW_TEST_REPORTER: require.resolve('./oopReporter'),
      PW_TEST_REPORTER_WS_ENDPOINT: wsEndpoint,
    };
  }

  private async _listen(): Promise<string> {
    const server = http.createServer((_, response) => response.end());
    server.on('error', error => console.error(error));

    const wsPath = '/' + createGuid();
    const wsEndpoint = await new Promise<string>((resolve, reject) => {
      server.listen(0, () => {
        const address = server.address();
        if (!address) {
          reject(new Error('Could not bind server socket'));
          return;
        }
        const wsEndpoint = typeof address === 'string' ? `${address}${wsPath}` : `ws://127.0.0.1:${address.port}${wsPath}`;
        resolve(wsEndpoint);
      }).on('error', reject);
    });

    const wsServer = new WebSocketServer({ server, path: wsPath });
    wsServer.on('connection', socket => this._onConnection(socket));
    this._wsServer = wsServer;

    return wsEndpoint;
  }

  private async _onConnection(socket: WebSocket) {
    const transport: ConnectionTransport = {
      send: function(message): void {
        if (socket.readyState !== WebSocket.CLOSING)
          socket.send(JSON.stringify(message));
      },

      isClosed() {
        return socket.readyState === WebSocket.CLOSED || socket.readyState === WebSocket.CLOSING;
      },

      close: () => {
        socket.close();
      }
    };

    socket.on('message', (message: string) => {
      transport.onmessage?.(JSON.parse(Buffer.from(message).toString()));
    });
    socket.on('close', () => {
      transport.onclose?.();
    });
    socket.on('error', () => {
      transport.onclose?.();
    });

    const listener = this._onTerminalRunStart();
    if (!listener)
      return;

    const teleReceiver = new TeleReporterReceiver(listener.listener, {
      mergeProjects: true,
      mergeTestCases: true,
      resolvePath: (rootDir: string, relativePath: string) => path.join(rootDir, relativePath),
    });

    transport.onmessage = message => {
      if (message.method === 'onEnd')
        transport.close();
      void teleReceiver.dispatch(message as any);
    };

    transport.onclose = () => {
      listener.onClose();
    };
  }

  close() {
    console.trace('Closing reporter server');
    this._wsServer?.close();
  }
}