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

import { expect, test } from './utils';


test('tool list', async ({ activate }) => {
  const { vscode } = await activate({
    'playwright.config.js': `module.exports = { testDir: 'tests' }`,
    'tests/test.spec.ts': `
      import { test } from '@playwright/test';
      test('one', async () => {});
    `,
  });

  const client = await vscode.connectToMCP();
  const tools = await client.listTools();
  expect(tools.tools.map(t => t.name)).toEqual([
    'getPlaywrightTestTree',
    'runPlaywrightTest',
  ]);
});

test('test tree', async ({ activate }) => {
  const { vscode, testController } = await activate({
    'playwright.config.js': `module.exports = { testDir: 'tests' }`,
    'tests/test.spec.ts': `
      import { test, expect } from '@playwright/test';
      test('pass', async () => {
        expect(true).toBe(true);
      });
      test('fail', async () => {
        expect(true).toBe(false);
      });
    `,
  });

  await testController.expandTestItems(/test.spec.ts/);

  const client = await vscode.connectToMCP();
  let result = await client.callTool({ name: 'getPlaywrightTestTree' });
  expect(result.content).toEqual([{ type: 'text', text: expect.any(String) }]);
  expect(result.structuredContent).toEqual({
    tests: [
      {
        id: expect.any(String),
        name: 'test.spec.ts › pass',
      },
      {
        id: expect.any(String),
        name: 'test.spec.ts › fail',
      }
    ]
  });

  const passingId = (result.structuredContent as any).tests[0].id;
  const failingId = (result.structuredContent as any).tests[1].id;

  result = await client.callTool({ name: 'runPlaywrightTest', arguments: { id: passingId } });
  expect(result.content).toEqual([{ type: 'text', text: 'Test passed.' }]);
  expect(result.structuredContent).toEqual({
    result: 'passed'
  });

  result = await client.callTool({ name: 'runPlaywrightTest', arguments: { id: failingId } });
  expect(result.content).toEqual([{
    type: 'text',
    text: 'Test failed. Use the test_failure tool to get the error message.',
  }]);
  expect(result.structuredContent).toEqual({
    result: 'failed'
  });
});
