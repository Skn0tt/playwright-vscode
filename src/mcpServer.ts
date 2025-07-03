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
import * as vscodeTypes from './vscodeTypes';
import http from 'http';
import net from 'net';
import { randomUUID } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { Transport } from '@modelcontextprotocol/sdk/shared/transport';
import { z } from 'zod';

const testTreeOutput = z.object({
  tests: z.array(z.object({
    id: z.string(),
    name: z.string(),
  }))
});

const runTestInput = z.object({
  id: z.string(),
});

const runTestOutput = z.object({
  result: z.enum(['passed', 'failed', 'skipped']),
});

interface MCPServerDelegate {
  getTestTree(): Promise<z.infer<typeof testTreeOutput>>;
  runTest(input: z.infer<typeof runTestInput>): Promise<z.infer<typeof runTestOutput>>;
}

export class MCPServer implements vscodeTypes.McpServerDefinitionProvider {
  private _server = http.createServer((req, res) => this._onRequest(req, res));
  private _addressPromise?: Promise<string>;

  private _transports: { [sessionId: string]: StreamableHTTPServerTransport } = {};

  private _path = '/' + crypto.randomUUID();

  constructor(private readonly _vscode: vscodeTypes.VSCode, private readonly _delegate: MCPServerDelegate) {}

  provideMcpServerDefinitions(token: vscodeTypes.CancellationToken) {
    return [
      new this._vscode.McpHttpServerDefinition('@playwright/test', this._vscode.Uri.parse('http://localhost'))
    ];
  }

  async resolveMcpServerDefinition(server: vscodeTypes.McpServerDefinition, token: vscodeTypes.CancellationToken) {
    if (server instanceof this._vscode.McpHttpServerDefinition) {
      const address = await this._listen();
      server.uri = this._vscode.Uri.parse(address + this._path);
      return server;
    }

    throw new Error('unreachable');
  }

  private _listen() {
    if (!this._addressPromise) {
      this._addressPromise = new Promise((resolve, reject) => {
        this._server
            .on('listening', () => {
              const { port } = this._server.address() as net.AddressInfo;
              resolve(`http://localhost:${port}`);
            })
            .on('error', reject)
            .listen(0);
      });
    }

    return this._addressPromise;
  }

  async stop() {
    await new Promise<void>((resolve, reject) => {
      this._server.close(err => err ? reject(err) : resolve());
    });
  }

  private _onRequest = async (req: http.IncomingMessage, res: http.ServerResponse) => {
    if (req.url === this._path) {
      if (req.method === 'POST')
        return await this._handlePostRequest(req, res);
      else if (req.method === 'GET' || req.method === 'DELETE')
        return await this._handleSessionRequest(req, res);
    }

    res.statusCode = 404;
    res.end();
  };

  private async _handlePostRequest(req: http.IncomingMessage, res: http.ServerResponse) {
    try {
      const body = await this._readRequestBody(req);
      const requestData = JSON.parse(body);

      const sessionId = req.headers['mcp-session-id'] as string | undefined;
      let transport: StreamableHTTPServerTransport;

      if (sessionId && this._transports[sessionId]) {
        transport = this._transports[sessionId];
      } else if (!sessionId && isInitializeRequest(requestData)) {
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: sessionId => {
            this._transports[sessionId] = transport;
          },
        });

        transport.onclose = () => {
          if (transport.sessionId)
            delete this._transports[transport.sessionId];
        };

        await this._onTransport(transport);
      } else {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          jsonrpc: '2.0',
          error: {
            code: -32000,
            message: 'Bad Request: No valid session ID provided',
          },
          id: null,
        }));
        return;
      }

      await transport.handleRequest(req, res, requestData);
    } catch (error) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        jsonrpc: '2.0',
        error: {
          code: -32603,
          message: 'Internal error',
        },
        id: null,
      }));
    }
  }

  private async _handleSessionRequest(req: http.IncomingMessage, res: http.ServerResponse) {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    if (!sessionId || !this._transports[sessionId]) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('Invalid or missing session ID');
      return;
    }

    const transport = this._transports[sessionId];
    await transport.handleRequest(req, res);
  }

  private _readRequestBody(req: http.IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      req.on('data', chunk => chunks.push(chunk));
      req.on('end', () => resolve(Buffer.concat(chunks).toString()));
      req.on('error', reject);
    });
  }

  private async _onTransport(transport: Transport) {
    const server = new McpServer({
      name: '@playwright/test',
      version: '0.0.0'
    });

    server.registerTool('getPlaywrightTestTree', { outputSchema: testTreeOutput.shape }, async () => {
      const tree = await this._delegate.getTestTree();
      return {
        content: [],
        structuredContent: tree
      };
    });

    server.registerTool('runPlaywrightTest', { inputSchema: runTestInput.shape, outputSchema: runTestOutput.shape }, async input => {
      const result = await this._delegate.runTest(input);
      return {
        content: result.result === 'failed' ? [{ type: 'text', text: 'Test failed. You can inspect the failure using the #testFailures tool.' }] : [],
        structuredContent: result
      };
    });

    await server.connect(transport);
  }
}