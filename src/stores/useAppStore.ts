import { create } from 'zustand';
import type { Project, SshHostModel } from '../types';
import { invokeCommand } from '../lib/tauri';

interface AppState {
    projects: Project[];
    hosts: SshHostModel[];
    isLoading: boolean;
    activeProject: string | null;

    fetchProjects: () => Promise<void>;
    fetchHosts: () => Promise<void>;
    createProject: (name: string, path: string, sshKeyPath?: string) => Promise<void>;
    updateProject: (id: string, name: string, path: string, sshKeyPath?: string) => Promise<void>;
    deleteProject: (id: string) => Promise<void>;
    updateProjectNotes: (id: string, notes: string) => Promise<void>;
    updateProjectSettings: (id: string, settings: string) => Promise<void>;
    setActiveProject: (id: string | null) => void;
}

export const useAppStore = create<AppState>((set) => ({
    projects: [],
    hosts: [],
    isLoading: false,
    activeProject: null,

    fetchProjects: async () => {
        set({ isLoading: true });
        try {
            const projects = await invokeCommand<Project[]>('list_projects');
            set({ projects });
        } catch {
            // Failed to fetch projects — silent, UI shows stale data
        } finally {
            set({ isLoading: false });
        }
    },

    fetchHosts: async () => {
        try {
            const hosts = await invokeCommand<SshHostModel[]>('get_ssh_hosts');
            set({ hosts });
        } catch {
            // Failed to fetch hosts — non-critical
        }
    },

    createProject: async (name, path, sshKeyPath) => {
        set({ isLoading: true });
        try {
            await invokeCommand('create_project', {
                name,
                path,
                sshKeyPath
            });
            // Refresh list
            const projects = await invokeCommand<Project[]>('list_projects');
            set({ projects });
        } catch (e) {
            throw e;
        } finally {
            set({ isLoading: false });
        }
    },

    updateProject: async (id, name, path, sshKeyPath) => {
        set({ isLoading: true });
        try {
            await invokeCommand('update_project', { id, name, path, sshKeyPath });
            const projects = await invokeCommand<Project[]>('list_projects');
            set({ projects });
        } catch (e) {
            throw e;
        } finally {
            set({ isLoading: false });
        }
    },

    deleteProject: async (id) => {
        set({ isLoading: true });
        try {
            await invokeCommand('delete_project', { id });
            const projects = await invokeCommand<Project[]>('list_projects');
            set({ projects });
        } catch (e) {
            throw e;
        } finally {
            set({ isLoading: false });
        }
    },

    updateProjectNotes: async (id, notes) => {
        // optimistically update? or just fetch. Fetching is safer.
        try {
            await invokeCommand('update_project_notes', { projectId: id, notes });
            // Silent refresh
            const projects = await invokeCommand<Project[]>('list_projects');
            set({ projects });
        } catch {
            // Failed to update notes — silent
        }
    },

    updateProjectSettings: async (id, settings) => {
        try {
            await invokeCommand('update_project_settings', { id, settings });
            const projects = await invokeCommand<Project[]>('list_projects');
            set({ projects });
        } catch {
            // Failed to update settings — silent
        }
    },

    setActiveProject: (id) => set({ activeProject: id }),
}));
