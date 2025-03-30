# ollama-commit

## Features

The "Ollama Commit" extension generates Git commit messages using the Ollama API. It helps you create concise, imperative commit messages based on the staged changes in your repository.

## Requirements

- Visual Studio Code version 1.80.0 or higher
- Ollama API running locally

### Installation

1. Install Visual Studio Code from [here](https://code.visualstudio.com/).
2. Install the "Ollama Commit" extension from the VS Code marketplace.
3. Ensure the Ollama API is running locally.

## Extension Settings

This extension contributes the following settings:

* `ollama-commit.apiUrl`: URL of the Ollama API generate endpoint.
* `ollama-commit.model`: Ollama model to use for generation (must be available locally).
* `ollama-commit.prompt`: Prompt template for Ollama. Use '{diff}' as placeholder for the git diff.
* `ollama-commit.maxDiffLength`: Maximum length of the git diff (in characters) to send to Ollama. Prevents overly long requests.

## Known Issues

- No known issues at the moment.

## Release Notes

### 0.1.0

- Initial release of Ollama Commit
