import * as vscode from 'vscode';
import axios from 'axios';
import { Readable } from 'stream';

// Structure expected for Ollama /api/generate response stream entries
interface OllamaGenerateResponse {
    model: string;
    created_at: string;
    response: string; // The generated text part
    done: boolean;    // True if this is the final part
    context?: number[]; // Optional context
    total_duration?: number;
    load_duration?: number;
    prompt_eval_count?: number;
    prompt_eval_duration?: number;
    eval_count?: number;
    eval_duration?: number;
}


// --- Helper Functions ---

/**
 * Gets the active Git extension API.
 */
async function getGitAPI() {
    try {
        const extension = vscode.extensions.getExtension('vscode.git');
        if (!extension) {
            vscode.window.showErrorMessage('Git extension is not available.');
            return undefined;
        }
        if (!extension.isActive) {
            await extension.activate();
        }
        const gitAPI = extension.exports.getAPI(1);
        if (!gitAPI) {
             vscode.window.showErrorMessage('Unable to get Git API.');
             return undefined;
        }
        return gitAPI;
    } catch (error) {
        console.error("Error getting Git API:", error);
        vscode.window.showErrorMessage(`Error getting Git API: ${error instanceof Error ? error.message : String(error)}`);
        return undefined;
    }
}

/**
 * Gets the staged Git diff.
 */
async function getStagedDiff(gitAPI: any): Promise<string | null> {
    if (!gitAPI || gitAPI.repositories.length === 0) {
        vscode.window.showInformationMessage('No Git repository found.');
        return null;
    }

    // Assuming the first repository is the relevant one for the workspace
    const repo = gitAPI.repositories[0];

    if (!repo) {
        vscode.window.showInformationMessage('No Git repository found.');
        return null;
    }

    try {
        // Use the Git API's diff method for staged changes
        const diff = await repo.diff(true); // true for cached/staged changes

        if (!diff || diff.length === 0) {
            vscode.window.showInformationMessage('No staged changes found.');
            return null;
        }
        return diff;
    } catch (error) {
        console.error("Error getting git diff:", error);
        vscode.window.showErrorMessage(`Error getting git diff: ${error instanceof Error ? error.message : String(error)}`);
        return null;
    }
}

/**
 * Calls the Ollama API to generate the commit message.
 */
async function generateCommitMessage(diff: string): Promise<string | null> {
    const config = vscode.workspace.getConfiguration('ollama-commit');
    const apiUrl = config.get<string>('apiUrl');
    const model = config.get<string>('model');
    const promptTemplate = config.get<string>('prompt');
    const maxDiffLength = config.get<number>('maxDiffLength', 4000);

    if (!apiUrl || !model || !promptTemplate) {
        vscode.window.showErrorMessage('Ollama Commit configuration is missing (API URL, Model, or Prompt). Please check settings.');
        return null;
    }

    const truncatedDiff = diff.length > maxDiffLength ? diff.substring(0, maxDiffLength) + "\n... (diff truncated)" : diff;
    const finalPrompt = promptTemplate.replace('{diff}', truncatedDiff);

    try {
        // *** REMOVED <string> generic ***
        const response = await axios.post(apiUrl, {
            model: model,
            prompt: finalPrompt,
            stream: true,
        }, {
            responseType: 'stream' // This makes response.data a Readable stream
        });

        let fullResponse = '';
        let generatedMessage = '';

        return new Promise((resolve, reject) => {
            // Explicitly type stream as Readable for clarity (optional but good practice)
            const stream = response.data as Readable;

            stream.on('data', (chunk: Buffer) => {
                fullResponse += chunk.toString();
                const jsonResponses = fullResponse.split('\n').filter(line => line.trim() !== '');
                let processedResponse = '';

                jsonResponses.forEach(jsonString => {
                    try {
                        const parsed = JSON.parse(jsonString) as OllamaGenerateResponse;
                        generatedMessage += parsed.response || '';
                        processedResponse += jsonString + '\n';
                    } catch (e) {
                        // Incomplete JSON, wait for more data
                    }
                });
                fullResponse = fullResponse.substring(processedResponse.length);
            });

            stream.on('end', () => {
                 if (fullResponse.trim()) {
                    try {
                        const parsed = JSON.parse(fullResponse) as OllamaGenerateResponse;
                        generatedMessage += parsed.response || '';
                    } catch (e) {
                         console.error("Error parsing final chunk:", e, fullResponse);
                    }
                 }
                let cleanedMessage = generatedMessage.trim();
                if ((cleanedMessage.startsWith('"') && cleanedMessage.endsWith('"')) || (cleanedMessage.startsWith("'") && cleanedMessage.endsWith("'"))) {
                    cleanedMessage = cleanedMessage.substring(1, cleanedMessage.length - 1);
                }
                cleanedMessage = cleanedMessage.replace(/^commit message:/i, '').trim();
                cleanedMessage = cleanedMessage.replace(/^message:/i, '').trim();

                 if (!cleanedMessage) {
                    vscode.window.showWarningMessage("Ollama returned an empty message.");
                    resolve(null);
                 } else {
                    resolve(cleanedMessage);
                 }
            });

            stream.on('error', (error: Error) => {
                console.error('Error streaming from Ollama:', error);
                 let errorMessage = `Error streaming from Ollama: ${error.message}`;
                 if (axios.isAxiosError(error) && error.response) {
                     errorMessage += `\nOllama Response: ${error.response.data}`;
                 } else if (error.message.includes('ECONNREFUSED')) {
                     errorMessage = `Connection refused. Is Ollama running at ${apiUrl}?`;
                 }
                vscode.window.showErrorMessage(errorMessage);
                reject(error);
            });
        });

    } catch (error) {
        console.error('Error calling Ollama API:', error);
        let errorMessage = 'Failed to generate commit message.';
        if (axios.isAxiosError(error)) {
            if (error.response) {
                // Attempt to read error data even from non-streamed errors
                let errorDetails = error.response.data;
                // If the error response itself is a stream (less likely but possible)
                if (errorDetails instanceof Readable) {
                    try {
                         // Try to read a bit of the stream for context
                         errorDetails = await new Promise((resolve) => {
                             let data = '';
                             errorDetails.on('data', (chunk: { toString: () => string; }) => data += chunk.toString());
                             errorDetails.on('end', () => resolve(data));
                             errorDetails.on('error', () => resolve('Error reading error stream'));
                             setTimeout(() => resolve(data || 'Timeout reading error stream'), 500); // Timeout
                         });
                    } catch { errorDetails = 'Could not read error stream.'}
                }
                errorMessage = `Ollama API Error (${error.response.status}): ${errorDetails?.error || errorDetails || error.response.statusText}`;
            } else if (error.request) {
                errorMessage = `Could not connect to Ollama API at ${apiUrl}. Is it running?`;
            } else {
                errorMessage = `Axios error: ${error.message}`;
            }
        } else if (error instanceof Error){
             errorMessage = `Error: ${error.message}`;
        }
        vscode.window.showErrorMessage(errorMessage);
        return null;
    }
}

// --- Extension Activation ---

export function activate(context: vscode.ExtensionContext) {
    console.log('Congratulations, your extension "ollama-commit" is now active!');

    let disposable = vscode.commands.registerCommand('ollama-commit.generate', async () => {
        const gitAPI = await getGitAPI();
        if (!gitAPI) {
            return; // Error shown in getGitAPI
        }

        if (gitAPI.repositories.length === 0) {
             vscode.window.showInformationMessage('No Git repository found in the workspace.');
             return;
        }
        const repo = gitAPI.repositories[0]; // Use the first repository

        await vscode.window.withProgress({
            location: vscode.ProgressLocation.SourceControl, // Show progress in SCM view
            title: "Generating commit message with Ollama...",
            cancellable: false // Ollama request cancellation isn't easily supported here yet
        }, async (progress) => {
            progress.report({ increment: 10 });

            // 1. Get Staged Diff
            const diff = await getStagedDiff(gitAPI);
            if (!diff) {
                // Appropriate message shown in getStagedDiff
                return;
            }
            progress.report({ increment: 30 });

            // 2. Generate Message via Ollama
            const generatedMessage = await generateCommitMessage(diff);
            progress.report({ increment: 50 });

            // 3. Populate Commit Input Box
            if (generatedMessage && repo.inputBox) {
                repo.inputBox.value = generatedMessage;
                vscode.window.showInformationMessage('Ollama commit message generated.');
                progress.report({ increment: 10 });
            } else if (generatedMessage === null) {
                 // Error or warning message was already shown by generateCommitMessage or getStagedDiff
            } else {
                 vscode.window.showWarningMessage('Could not find Git commit input box.');
            }

        }); // End withProgress
    }); // End registerCommand

    context.subscriptions.push(disposable);
}

// --- Extension Deactivation ---

export function deactivate() {
    console.log('Extension "ollama-commit" is now deactivated.');
}