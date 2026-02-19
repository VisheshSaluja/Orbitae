# Orbitae

Orbitae is a powerful, developer-focused desktop workspace manager designed to streamline your development workflow. It acts as a central hub for managing your projects, running commands, keeping notes, and monitoring processes—all without leaving the app.

## Features

### 🚀 Process Manager (Command Center)
A fully integrated terminal and process management system.
-   **Multi-Process Support**: Run multiple long-running commands (e.g., `npm run dev`, `docker compose up`) simultaneously in the background.
-   **Internal Terminal**: High-performance terminal emulation using `xterm.js` and `portable-pty`.
-   **Smart Persistence**: Processes stay alive and visible even when you switch tabs or close the project dialog.
-   **Saved Commands**: Save frequently used commands as snippets for one-click execution.
-   **Scripts Integration**: Automatically detects `scripts` from `package.json` and launches them internally.

### 📝 Smart Notes
A rich-text editor tailored for developers.
-   **TipTap Editor**: Notion-style slash commands and block-based editing.
-   **Code Support**: Syntax highlighting for code blocks.
-   **Project-Scoped**: Notes are attached to specific projects for context.

### 🛠 Project Tools
-   **Git Graph**: Visual history of your repository branches and commits.
-   **Secrets Management**: Securely store and view environment variables or keys.
-   **Snippets Library**: A dedicated library for storing reusable code snippets or commands.
-   **Quick Stats**: Overview of your project's language distribution and activity.

## Installation & Testing (Alpha)

Orbitae is currently in alpha testing. If you do not have an Apple Developer account, you may encounter security warnings when trying to run the app.

### Download
Go to the [Releases](https://github.com/VisheshSaluja/Switchboard/releases) page and download the latest `.dmg` for macOS (or `.msi`/`.exe` for Windows).

### ⚠️ macOS Troubleshooting ("App is damaged")
Since this app is not yet signed with an Apple Developer Certificate, you might see a "Orbitae is damaged and can't be opened" error. Currently, to bypass Apple's security check for unsigned apps, follow these steps:

**Option 1: Right-Click Open**
1.  Right-click the app in your Applications folder.
2.  Select **Open**.
3.  Click **Open** in the confirmation dialog.

**Option 2: Terminal Command (If Option 1 fails)**
Run this command in your terminal to remove the quarantine flag:
```bash
xattr -cr /Applications/Orbitae.app
```
(Replace `/Applications/Orbitae.app` with the actual path if you installed it elsewhere).

## Tech Stack

Building a high-performance desktop app requires a robust stack. Orbitae is built on:

### Frontend
-   **Framework**: [React 19](https://react.dev/) + [TypeScript](https://www.typescriptlang.org/)
-   **Build Tool**: [Vite](https://vitejs.dev/)
-   **Styling**: [Tailwind CSS v4](https://tailwindcss.com/)
-   **UI Components**: [Shadcn/UI](https://ui.shadcn.com/) + [Radix UI](https://www.radix-ui.com/) (using `react-resizable-panels`)
-   **Icons**: [Lucide React](https://lucide.dev/)
-   **Terminal**: [xterm.js](https://xtermjs.org/)
-   **Editor**: [TipTap](https://tiptap.dev/)
-   **State Management**: [Zustand](https://github.com/pmndrs/zustand)
-   **Notifications**: [Sonner](https://sonner.emilkowal.ski/)

### Backend
-   **Core**: [Rust](https://www.rust-lang.org/) (via [Tauri v2](https://v2.tauri.app/))
-   **Database**: [SQLite](https://sqlite.org/) (managed by [SQLx](https://github.com/launchbadge/sqlx))
-   **Terminal Backend**: [portable-pty](https://github.com/wez/wezterm/tree/main/portable-pty) for cross-platform PTY management.
-   **Serialization**: [Serde](https://serde.rs/)

## Architecture

Orbitae follows a **local-first** architecture.
-   All metadata (projects, notes, snippets, settings) is stored locally in an SQLite database.
-   It interacts directly with your filesystem to run commands and manage git repositories.
-   No cloud dependency—your data stays on your machine.

## Development

To run Orbitae locally:

1.  **Prerequisites**: Ensure you have Node.js, Rust, and Tauri prerequisites installed.
2.  **Install Dependencies**:
    ```bash
    npm install
    ```
3.  **Run Development Server**:
    ```bash
    npm run tauri dev
    ```
