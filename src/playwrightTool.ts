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
import type { CancellationToken, LanguageModelTool, LanguageModelToolInvocationOptions, LanguageModelToolResult, ProviderResult } from 'vscode';

export class PlaywrightTool implements LanguageModelTool<{}> {
  constructor(private readonly vscode: typeof import('vscode')) {}

  invoke(options: LanguageModelToolInvocationOptions<{}>, token: CancellationToken): ProviderResult<LanguageModelToolResult> {
    return {
      content: [
        new this.vscode.LanguageModelTextPart(`
Don't write any code before you have verified the test flow by executing it in the browser. After executing the test flow, please let me know if the page matches the flow. If it doesn't, tell me what's off. If it does, formulate an outline for a Playwright test that executes the test flow. Lay out the actions and assertions, think about what makes sense to assert. Send me a condensed outline of that.

After sending me the outline, generate Playwright code for the test and add it to my repository. The test should be in the same format as the other tests in the repository. Keep in mind that automated tests are a little different from the test flow written for humans. Here are some things to consider:

- If the test flow asks you to check if something is visible, also test some of the contents using toMatchAriaSnapshot.
- \`toMatchAriaSnapshot\` doesn't support the \`generic\` role - just omit these elements from the expected snapshot.
- Don't add multiple branches to the page, you can expect the page to look the same every time.
- Playwright automatically waits for elements before interacting with them, so you don't need to check visibility before clicking or typing.
- Add section comments to the test that reference the test flow step numbers.
- After writing the test, iterate until it passes using the run test tool. Do not use the terminal tool for it, as you won't be able to see errors.
        `)
      ]
    };
  }
}
