import { invoke } from "@tauri-apps/api/core";
import { logger } from "./logger";

const isTauri = () => {
    return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
};

export async function invokeCommand<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
    if (!isTauri()) {
        logger.warn(`[Mock Mode] Tauri not detected. Command '${cmd}' simulated.`);
        if (cmd === 'list_projects') return [] as T;
        if (cmd === 'get_ssh_hosts') return [] as T;
        throw new Error(`Tauri environment not found. Please run with 'npx tauri dev' and use the Application Window, not the browser.`);
    }

    try {
        return await invoke<T>(cmd, args);
    } catch (error) {
        logger.error(`Tauri command '${cmd}' failed:`, error);
        throw error;
    }
}
