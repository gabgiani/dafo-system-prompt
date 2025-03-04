import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";

export function activate(context: vscode.ExtensionContext) {
  // Register command to open the prompt configurator UI
  let disposable = vscode.commands.registerCommand("copilotPromptConfig.open", () => {
    CopilotPromptPanel.createOrShow(context.extensionUri);
  });

  context.subscriptions.push(disposable);

  // Automatically inject the correct prompt for each language
  vscode.workspace.onDidOpenTextDocument((document) => {
    applyPromptToEditor(document);
  });

  vscode.window.onDidChangeActiveTextEditor((editor) => {
    if (editor) {
      applyPromptToEditor(editor.document);
    }
  });
}

// 🔹 Function to find and apply the correct language prompt
function applyPromptToEditor(document: vscode.TextDocument) {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document !== document) return;

  const lang = document.languageId;
  const promptFilePath = findPromptFile(document, lang);
  if (!promptFilePath) return;

  const promptContent = fs.readFileSync(promptFilePath, "utf-8");
  const commentBlock = promptContent.split("\n").map((line) => `# ${line}`).join("\n");

  editor.edit((editBuilder) => {
    editBuilder.insert(new vscode.Position(0, 0), commentBlock + "\n\n");
  });
}

// 🔹 Function to find the correct prompt file based on language
function findPromptFile(document: vscode.TextDocument, lang: string): string | null {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders) return null;

  for (const folder of workspaceFolders) {
    const promptFilePath = path.join(folder.uri.fsPath, `.copilot-prompt-${lang}`);
    if (fs.existsSync(promptFilePath)) {
      return promptFilePath;
    }
  }
  return null;
}

// 🔹 Webview UI for prompt configuration
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
      if (x) {
        x.dispose();
      }
    }
  }

  // 🔹 Webview UI with tabs for different languages
  private getWebviewContent(): string {
    return `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Copilot Prompt Configurator</title>
        <style>
          body { font-family: Arial, sans-serif; padding: 20px; }
          textarea { width: 100%; height: 150px; margin-bottom: 10px; }
          button { background-color: #007acc; color: white; padding: 10px; border: none; cursor: pointer; }
          .tabs { display: flex; gap: 10px; margin-bottom: 10px; }
          .tab { padding: 8px; background: #007acc; color: white; cursor: pointer; border-radius: 4px; }
          .tab.active { background: #005fa3; }
        </style>
      </head>
      <body>
        <h2>Configure Copilot Prompts</h2>
        <div class="tabs">
          <div class="tab active" onclick="switchTab('python')">Python</div>
          <div class="tab" onclick="switchTab('javascript')">JavaScript</div>
          <div class="tab" onclick="switchTab('typescript')">TypeScript</div>
        </div>
        <textarea id="promptText"></textarea>
        <button onclick="savePrompt()">Save</button>
        
        <script>
        const vscode = acquireVsCodeApi();
        let currentLanguage = "python";

        function switchTab(language) {
          document.querySelectorAll('.tab').forEach(tab => tab.classList.remove('active'));
          document.querySelector('.tab[onclick="switchTab(\'' + language + '\')"]').classList.add('active');
          currentLanguage = language;
          console.log("Switching tab to:", currentLanguage); // DEBUG LOG
          loadPrompt();
        }

        function savePrompt() {
          const prompt = document.getElementById("promptText").value;
          vscode.postMessage({ command: "savePrompt", language: currentLanguage, prompt: prompt });
        }

        function loadPrompt() {
          vscode.postMessage({ command: "loadPrompt", language: currentLanguage });
        }

        window.addEventListener("message", (event) => {
          const message = event.data;
          if (message.command === "setPrompt") {
            document.getElementById("promptText").value = message.prompt;
          }
        });

        loadPrompt();
      </script>
   </body>
      </html>
    `;
  }

  private _setWebviewMessageListener(webview: vscode.Webview) {
    webview.onDidReceiveMessage((message) => {
      if (message.command === "savePrompt") {
        this.savePromptToFile(message.language, message.prompt);
      } else if (message.command === "loadPrompt") {
        this.loadPromptFromFile(message.language);
      }
    }, null, this._disposables);
  }
  
  // Save the prompt for the selected language
  private savePromptToFile(language: string, prompt: string) {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {return};
  
    const promptFilePath = path.join(workspaceFolders[0].uri.fsPath, `.copilot-prompt-${language}`);
    fs.writeFileSync(promptFilePath, prompt, "utf-8");
    vscode.window.showInformationMessage(`Copilot Prompt for ${language} saved successfully!`);
  }
  
  // Load the existing prompt when switching tabs
  private loadPromptFromFile(language: string) {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {return};
  
    const promptFilePath = path.join(workspaceFolders[0].uri.fsPath, `.copilot-prompt-${language}`);
    let prompt = "";
    if (fs.existsSync(promptFilePath)) {
      prompt = fs.readFileSync(promptFilePath, "utf-8");
    }
  
    this._panel.webview.postMessage({ command: "setPrompt", prompt: prompt });
  }
}