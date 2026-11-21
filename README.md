# Nexus Agent OS — Local Multi-Agent Desktop App

Desktop app (Electron + React + Node.js/TypeScript) ដែលឲ្យ AI Agents 4 ធ្វើការជាមួយគ្នាលើ Windows Laptop របស់អ្នកផ្ទាល់។

## 4 Built-in Agents
- **Orchestrator**: បំបែកការងារជា plan, ចែកទៅ specialist agents (sequential ឬ parallel) និងសង្ខេបលទ្ធផល។
- **File Agent**: list, read, search, write, create folder, move/rename, delete files/folders លើ laptop។
- **System Agent**: run PowerShell, បើក Windows apps, monitor CPU/RAM/Disk/Processes, clipboard, capture live desktop screenshot។
- **Browser Agent**: web search, fetch & parse pages, headless Chrome/Edge JS DOM dump, open URLs in browser។

## Safety Modes
- **Safe**: សួរ `Allow / Deny` រាល់ tool call ទាំងអស់។
- **Smart (Default)**: Auto-run ការងារអាន (`read`), សួរការអនុញ្ញាតមុនពេល `write` ឬ `danger`។
- **Auto (Full Auto)**: Run ទាំងអស់ដោយមិនសួរ។

## Run Locally

```bash
# 1. Desktop App Mode (Electron + Local Server + UI)
npm run dev

# 2. Browser-only Mode (if you want to open in Chrome at http://127.0.0.1:5178)
npm run dev:web
```

## AI Setup
Open **Settings (⚙️)** inside the app:
- **Gemini API**: Paste your Gemini API Key (`gemini-3.8-flash` / Gemini 3.8 Flash recommended).
- **Ollama Local (Free)**: Switch Provider to `Ollama Local`, click `Detect Installed Models`, and test connection.
- **OpenAI-Compatible**: Works with OpenAI, OpenRouter, Groq, LM Studio, DeepSeek, etc.
