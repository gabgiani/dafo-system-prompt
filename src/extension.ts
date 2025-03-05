import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";

// Instruction types supported by Copilot
const INSTRUCTION_TYPES = {
  CODE_GENERATION: 'github.copilot.chat.codeGeneration.instructions',
  TEST_GENERATION: 'github.copilot.chat.testGeneration.instructions',
  CODE_REVIEW: 'github.copilot.chat.reviewSelection.instructions',
  COMMIT_MESSAGE: 'github.copilot.chat.commitMessageGeneration.instructions'
} as const;

const SUPPORTED_LANGUAGES = [
  "python", "javascript", "typescript", "java", "c", "cpp", "csharp", "dart",
  "swift", "kotlin", "ruby", "php", "rust", "lua", "shellscript", "sql", "r",
  "html", "css", "scss", "sass", "react", "nextjs", "vue", "svelte", "angular",
  "flutter", "nodejs", "django", "flask", "express", "fastapi", "spring", "rails",
  "laravel", "unity", "unreal", "godot", "tensorflow", "pytorch", "arduino"
];

interface LanguagePrompts {
  [key: string]: {
    [instructionType: string]: string;
  };
}

export function activate(context: vscode.ExtensionContext) {
  // Register UI command
  let disposable = vscode.commands.registerCommand("copilotPromptConfig.open", () => {
    CopilotPromptPanel.createOrShow(context.extensionUri);
  });
  context.subscriptions.push(disposable);

  // Watch for workspace changes
  setupWorkspaceWatchers(context);

  // Apply initial configuration
  applyWorkspaceConfiguration();
}

function setupWorkspaceWatchers(context: vscode.ExtensionContext) {
  // Watch .github/copilot-instructions.md
  const instructionsWatcher = vscode.workspace.createFileSystemWatcher(
    "**/.github/copilot-instructions.md"
  );
  
  // Watch .github/prompts folder
  const promptsWatcher = vscode.workspace.createFileSystemWatcher(
    "**/.github/prompts/*.prompt.md"
  );

  // Watch .vscode/copilot.json
  const configWatcher = vscode.workspace.createFileSystemWatcher(
    "**/.vscode/copilot.json"
  );

  [instructionsWatcher, promptsWatcher, configWatcher].forEach(watcher => {
    watcher.onDidChange(() => applyWorkspaceConfiguration());
    watcher.onDidCreate(() => applyWorkspaceConfiguration());
    watcher.onDidDelete(() => applyWorkspaceConfiguration());
    context.subscriptions.push(watcher);
  });
}

async function applyWorkspaceConfiguration() {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders) {return;}

  const config = vscode.workspace.getConfiguration('copilotPrompt');
  const rootPath = workspaceFolders[0].uri.fsPath;
  
  // Check if workspace prompts are enabled
  if (config.get('enableWorkspacePrompts')) {
    // Load and apply instructions from .github/copilot-instructions.md
    await applyGlobalInstructions(rootPath);
    
    // Load and apply language-specific settings if enabled
    if (config.get('enableLanguageSpecific')) {
      await applyLanguageSpecificSettings(rootPath);
    }
  }
  
  // Enable prompt files if configured
  if (config.get('enablePromptFiles')) {
    await setupPromptFiles(rootPath);
  }
}

async function applyGlobalInstructions(rootPath: string) {
  const instructionsPath = path.join(rootPath, '.github/copilot-instructions.md');
  
  if (fs.existsSync(instructionsPath)) {
    const instructions = fs.readFileSync(instructionsPath, 'utf8');
    await updateCopilotSetting(INSTRUCTION_TYPES.CODE_GENERATION, [{ text: instructions }]);
  }
}

async function applyLanguageSpecificSettings(rootPath: string) {
  const configPath = path.join(rootPath, '.vscode/copilot.json');
  
  if (fs.existsSync(configPath)) {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    
    for (const [key, value] of Object.entries(config)) {
      if (INSTRUCTION_TYPES[key as keyof typeof INSTRUCTION_TYPES]) {
        await updateCopilotSetting(INSTRUCTION_TYPES[key as keyof typeof INSTRUCTION_TYPES], value);
      }
    }
  }
}

async function setupPromptFiles(rootPath: string) {
  const promptsPath = path.join(rootPath, '.github/prompts');
  
  if (fs.existsSync(promptsPath)) {
    // Enable both the VS Code setting and Copilot setting
    await Promise.all([
      vscode.workspace.getConfiguration().update(
        'chat.promptFiles',
        { [promptsPath]: true },
        vscode.ConfigurationTarget.Workspace
      ),
      vscode.workspace.getConfiguration().update(
        'github.copilot.chat.codeGeneration.useInstructionFiles',
        true,
        vscode.ConfigurationTarget.Workspace
      )
    ]);
  }
}

async function updateCopilotSetting(setting: string, value: any) {
  try {
    const config = vscode.workspace.getConfiguration();
    await config.update(setting, value, vscode.ConfigurationTarget.Workspace);
    
    // Try multiple known Copilot restart commands
    try {
      // Try the new command first
      await vscode.commands.executeCommand('github.copilot.toggleCopilot');
      await new Promise(resolve => setTimeout(resolve, 1000)); // Wait for Copilot to toggle
      await vscode.commands.executeCommand('github.copilot.toggleCopilot');
    } catch (restartError) {
      try {
        // Fallback to older command
        await vscode.commands.executeCommand('github.copilot.reload');
      } catch (reloadError) {
        // If both fail, just show a message to the user
        vscode.window.showInformationMessage(
          'Please reload VS Code to apply the new Copilot settings'
        );
      }
    }
    
    vscode.window.showInformationMessage(`Copilot configuration updated for ${setting}`);
  } catch (error) {
    vscode.window.showErrorMessage(`Failed to update Copilot configuration: ${error}`);
    console.error('Error updating Copilot setting:', error);
  }
}

async function loadLanguagePromptsFromFile(rootPath: string): Promise<LanguagePrompts> {
  const instructionsPath = path.join(rootPath, '.github/copilot-instructions.md');
  
  if (!fs.existsSync(instructionsPath)) {
    return {};
  }

  const content = fs.readFileSync(instructionsPath, 'utf8');
  const jsonMatch = content.match(/```json\n([\s\S]*?)\n```/);
  
  if (jsonMatch && jsonMatch[1]) {
    try {
      return JSON.parse(jsonMatch[1]);
    } catch (error) {
      console.error('Error parsing JSON from markdown:', error);
    }
  }
  
  return {};
}

async function saveLanguagePromptsToFile(rootPath: string, prompts: LanguagePrompts) {
  const githubDir = path.join(rootPath, '.github');
  if (!fs.existsSync(githubDir)) {
    fs.mkdirSync(githubDir);
  }

  const instructionsPath = path.join(githubDir, 'copilot-instructions.md');
  const content = `# Copilot Instructions

This file contains language-specific prompts for GitHub Copilot.

\`\`\`json
${JSON.stringify(prompts, null, 2)}
\`\`\`
`;

  fs.writeFileSync(instructionsPath, content);
}

class CopilotPromptPanel {
  public static currentPanel: CopilotPromptPanel | undefined;
  private readonly _panel: vscode.WebviewPanel;
  private _disposables: vscode.Disposable[] = [];

  public static createOrShow(extensionUri: vscode.Uri) {
    if (CopilotPromptPanel.currentPanel) {
      CopilotPromptPanel.currentPanel._panel.reveal(vscode.ViewColumn.One);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      "copilotPromptConfig",
      "Copilot Prompt Configurator",
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        localResourceRoots: [extensionUri]
      }
    );

    CopilotPromptPanel.currentPanel = new CopilotPromptPanel(panel, extensionUri);
  }

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
    this._panel = panel;
    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
    this._panel.webview.html = this.getWebviewContent();
    this._setWebviewMessageListener(this._panel.webview);
  }

  public dispose() {
    CopilotPromptPanel.currentPanel = undefined;
    this._panel.dispose();
    while (this._disposables.length) {
      const x = this._disposables.pop();
      if (x) {x.dispose();}
    }
  }

  private getWebviewContent(): string {
    return `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Copilot Configuration</title>
        <style>
          body { font-family: Arial, sans-serif; padding: 20px; }
          .container { max-width: 800px; margin: 0 auto; }
          .section { margin-bottom: 20px; }
          select { width: 100%; margin-bottom: 10px; padding: 8px; }
          textarea { width: 100%; height: 150px; margin: 10px 0; }
          button { padding: 8px 16px; background: #0066cc; color: white; border: none; cursor: pointer; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="section">
            <h2>Copilot Configuration</h2>
            <select id="instructionType" onchange="loadTypeLanguagePrompt()">
              <option value="CODE_GENERATION">Code Generation</option>
              <option value="TEST_GENERATION">Test Generation</option>
              <option value="CODE_REVIEW">Code Review</option>
              <option value="COMMIT_MESSAGE">Commit Messages</option>
            </select>
            <select id="language" onchange="loadTypeLanguagePrompt()">
              <option value="">Global Setting</option>
              ${SUPPORTED_LANGUAGES.map(lang => 
                `<option value="${lang}">${lang}</option>`).join('')}
            </select>
            <textarea id="promptText" placeholder="Enter instructions..."></textarea>
            <button id="saveButton">Save Instructions</button>
          </div>
        </div>
        <script>
          const vscode = acquireVsCodeApi();
          
          function loadTypeLanguagePrompt() {
            const type = document.getElementById('instructionType').value;
            const lang = document.getElementById('language').value;
            vscode.postMessage({ 
              command: 'loadTypeLanguagePrompt',
              type,
              lang
            });
          }
          
          document.getElementById('saveButton').addEventListener('click', () => {
            const type = document.getElementById('instructionType').value;
            const lang = document.getElementById('language').value;
            const prompt = document.getElementById('promptText').value;
            
            vscode.postMessage({ 
              command: 'saveInstructions',
              type,
              lang,
              prompt
            });
          });

          window.addEventListener('message', event => {
            const message = event.data;
            if (message.command === 'setPrompt') {
              document.getElementById('promptText').value = message.prompt || '';
            }
          });

          // Load initial prompt
          loadTypeLanguagePrompt();
        </script>
      </body>
      </html>
    `;
  }

  private _setWebviewMessageListener(webview: vscode.Webview) {
    webview.onDidReceiveMessage(async (message) => {
      switch (message.command) {
        case 'saveInstructions':
          await this.saveInstructions(message.type, message.lang, message.prompt);
          break;
        case 'loadTypeLanguagePrompt':
          await this.loadTypeLanguagePrompt(message.type, message.lang);
          break;
      }
    }, null, this._disposables);
  }

  private async saveInstructions(type: string, lang: string, prompt: string) {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) return;

    try {
      const rootPath = workspaceFolders[0].uri.fsPath;
      const prompts = await loadLanguagePromptsFromFile(rootPath);
      
      if (lang) {
        // Initialize language object if it doesn't exist
        if (!prompts[lang]) {
          prompts[lang] = {};
        }
        prompts[lang][type] = prompt;
      } else {
        // Global setting goes under 'global' key
        if (!prompts['global']) {
          prompts['global'] = {};
        }
        prompts['global'][type] = prompt;
      }

      await saveLanguagePromptsToFile(rootPath, prompts);
      
      // Update Copilot settings
      const setting = INSTRUCTION_TYPES[type as keyof typeof INSTRUCTION_TYPES];
      await updateCopilotSetting(setting, [{
        text: prompt,
        ...(lang && { language: lang })
      }]);

      vscode.window.showInformationMessage('Copilot instructions saved successfully');
    } catch (error) {
      vscode.window.showErrorMessage('Failed to save Copilot instructions');
      console.error('Error saving instructions:', error);
    }
  }

  private async loadTypeLanguagePrompt(type: string, lang: string) {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) return;

    try {
      const rootPath = workspaceFolders[0].uri.fsPath;
      const prompts = await loadLanguagePromptsFromFile(rootPath);
      
      let prompt = '';
      if (lang && prompts[lang]) {
        prompt = prompts[lang][type] || '';
      } else if (prompts['global']) {
        prompt = prompts['global'][type] || '';
      }

      this._panel.webview.postMessage({ command: 'setPrompt', prompt });
    } catch (error) {
      console.error('Error loading prompt:', error);
      vscode.window.showErrorMessage('Failed to load Copilot prompt');
    }
  }
}