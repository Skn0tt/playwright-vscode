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

import { test, expect } from './utils';

test.describe('pageSnapshot', () => {
  test('should run test when no page snapshot exists', async ({ activate }) => {
    const { vscode, testController } = await activate({
      'playwright.config.js': `module.exports = {}`,
      'foo.spec.ts': `
        import { test, expect } from '@playwright/test';
        test('foo', async ({ page }) => {
          await page.setContent('<h1>Hello world</h1>');
          expect(1).toBe(2)
        });
      `
    });

    await testController.expandTestItems(/.*/);

    const filePath = test.info().outputPath('foo.spec.ts');
    const result = await vscode.lm.invokePageSnapshotTool({ filePath, testName: 'foo' });
    expect(result.confirmation).toEqual(`Run test to generate page snapshot? Can Copilot execute the test foo.spec.ts >> "foo" to retrieve its page snapshot?`);
    expect(result.invocation).toEqual(`Running test to read page snapshot of [](file://${filePath}) >> foo`);
    expect(result.content).toContain('- heading "Hello world" [level=1]');

    const result2 = await vscode.lm.invokePageSnapshotTool({ filePath, lineNumber: 3 });
    expect(result2.confirmation).toBeUndefined();
    expect(result2.invocation).toEqual(`Reading page snapshot of [](file://${filePath}) >> foo`);
    expect(result2.content).toEqual(result.content);

    await expect(vscode).toHaveConnectionLog([
      { method: 'listFiles', params: {} },
      { method: 'listTests', params: expect.any(Object) },
      { method: 'runGlobalSetup', params: {} },
      { method: 'runTests', params: expect.objectContaining({ // happens only once, second prompt reuses result
        testIds: [expect.any(String)],
        pageSnapshot: 'on'
      }) },
    ]);
  });
});
