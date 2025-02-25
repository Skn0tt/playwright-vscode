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
import { Extension, pageSnapshotPathSymbol, testRunOptionsSymbol } from './extension';
import * as vscodeTypes from './vscodeTypes';
import { PlaywrightTestRunOptions } from './playwrightTestTypes';

export interface PageSnapshotToolProperties {
  filePath: string;
  lineNumber?: number;
  testName?: string;
}

export class PageSnapshotTool implements vscodeTypes.LanguageModelTool<PageSnapshotToolProperties> {
  constructor(
    private _extension: Extension,
    private _vscode: vscodeTypes.VSCode,
  ) {}

  private async _findSnapshot({
    filePath,
    lineNumber,
    testName,
  }: PageSnapshotToolProperties): Promise<
    | {
        fileItem: vscodeTypes.TestItem;
        testItem?: vscodeTypes.TestItem;
        pageSnapshot?: string;
      }
    | undefined
  > {
    const fileItem = this._extension._testTree.testItemForFile(filePath);
    if (!fileItem) return undefined;

    let testItem: vscodeTypes.TestItem | undefined;

    const tests = this._extension._testTree.collectTestsInside(fileItem);
    if (lineNumber) {
      tests.sort((a, b) => a.range!.start.line - b.range!.start.line);
      testItem = tests.findLast(test => test.range!.start.line <= lineNumber);
    } else if (testName) {
      testItem = tests.find(
          test =>
            test.label.includes(testName) || test.description?.includes(testName)
      );
    } else {
      testItem = tests[0];
    }

    let pageSnapshot: string | undefined;

    const pageSnapshotPath = (testItem as any)?.[pageSnapshotPathSymbol];
    if (pageSnapshotPath) {
      pageSnapshot = await this._vscode.workspace.fs
          .readFile(this._vscode.Uri.file(pageSnapshotPath))
          .then(
              s => s.toString(),
              () => undefined
          );
    }

    return { fileItem, testItem, pageSnapshot };
  }

  async prepareInvocation(
    options: vscodeTypes.LanguageModelToolInvocationOptions<PageSnapshotToolProperties>
  ): Promise<vscodeTypes.PreparedToolInvocation> {
    const result = await this._prepareInvocation(options);
    if (typeof result === 'string')
      return { invocationMessage: new this._vscode.MarkdownString(result) };
    return result;
  }

  async invoke(
    options: vscodeTypes.LanguageModelToolInvocationOptions<PageSnapshotToolProperties>,
    token: vscodeTypes.CancellationToken
  ) {
    const message = await this._invoke(options, token);
    return new this._vscode.LanguageModelToolResult([
      new this._vscode.LanguageModelTextPart(message),
    ]);
  }

  private async _prepareInvocation(
    options: vscodeTypes.LanguageModelToolInvocationOptions<PageSnapshotToolProperties>
  ): Promise<vscodeTypes.PreparedToolInvocation | string> {
    const { filePath, lineNumber, testName } = options.input;
    const file = `[](file://${filePath})`;

    const result = await this._findSnapshot(options.input);
    if (result?.testItem) {
      if (result.pageSnapshot)
        return `Reading page snapshot of ${file} >> ${result.testItem.label}`;

      return {
        invocationMessage: new this._vscode.MarkdownString(
            `Running test to read page snapshot of ${file} >> ${result.testItem.label}`
        ),
        confirmationMessages: {
          title: `Run test to generate page snapshot?`,
          message: new this._vscode.MarkdownString(
              `Can Copilot execute the test ${path.basename(filePath)} >> "${
                result.testItem.label
              }" to retrieve its page snapshot?`
          ),
        },
      };
    }

    if (!result) return `Could not find tests in ${file}`;

    if (lineNumber)
      return `Could not find test at line ${lineNumber} in ${file}`;

    if (testName) return `Could not find test "${testName}" in ${file}`;

    return `Could not find test in ${file}`;
  }

  private async _invoke(
    options: vscodeTypes.LanguageModelToolInvocationOptions<PageSnapshotToolProperties>,
    token: vscodeTypes.CancellationToken
  ) {
    const result = await this._findSnapshot(options.input);
    if (!result)
      return `File not found. Maybe re-run all tests to discover it?`;

    const { testItem } = result;
    if (!testItem) {
      if (options.input.lineNumber)
        return `Couldn't find test at this line number in the file. Please give me a line number inside a test case.`;

      if (options.input.testName)
        return `File doesnt contain provided test-name. Are you sure?`;

      return `File contains no tests. Are you sure this is the right file?`;
    }

    let pageSnapshot = result.pageSnapshot;

    if (!pageSnapshot) {
      const request = new this._vscode.TestRunRequest([testItem], [], undefined, false, true);
      (request as any)[testRunOptionsSymbol] = { pageSnapshot: 'on' } satisfies PlaywrightTestRunOptions;
      await this._extension._handleTestRun(false, request);
      const result = await this._findSnapshot(options.input);
      pageSnapshot = result?.pageSnapshot;
    }

    if (!pageSnapshot)
      return `No page snapshot found for this test. Something went wrong.`;

    return [
      'Here is the page contents after the test, in the form of an ARIA tree.',
      '',
      'When writing test code, follow Playwright best-practices:',
      '- use getByRole locators when possible',
      '- only use locator() if no other locator works',
      '- use toHaveText, toHaveValue instead of toBeVisible',
      '- dont add a navigation if there is already one in a beforeEach',
      '',
      '```yml',
      pageSnapshot,
      '```',
    ].join('\n');
  }
}

export function registerPageSnapshotTool(extension: Extension, vscode: vscodeTypes.VSCode) {
  return vscode.lm.registerTool(
      'playwright_pageSnapshot',
      new PageSnapshotTool(extension, vscode)
  );
}