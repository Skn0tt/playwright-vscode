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
  expect(tools.tools.map(t => t.name)).toEqual(['getPlaywrightTestTree']);
});

test('test tree', async ({ activate }) => {
  const { vscode } = await activate({
    'playwright.config.js': `module.exports = { testDir: 'tests' }`,
    'tests/test.spec.ts': `
      import { test } from '@playwright/test';
      test('one', async () => {});
    `,
  });

  const client = await vscode.connectToMCP();
  const result = await client.callTool({ name: 'getPlaywrightTestTree' });
  expect(result.content).toEqual([]);
  expect(result.structuredContent).toEqual({
    tests: [
      {
        id: 'root',
        name: 'Playwright Tests',
      }
    ]
  });
});
