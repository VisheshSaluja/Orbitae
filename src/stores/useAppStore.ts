import { create } from 'zustand';
import type { Project } from '../types';
import { invokeCommand } from '../lib/tauri';

interface AppState {
    projects: Project[];
    isLoading: boolean;
    activeProject: string | null;

    fetchProjects: () => Promise<void>;
    createProject: (name: string, path: string) => Promise<void>;
    updateProject: (id: string, name: string, path: string) => Promise<void>;
    deleteProject: (id: string) => Promise<void>;
    setActiveProject: (id: string | null) => void;
    updateProjectSettings: (id: string, settings: string) => Promise<void>;
}

export const useAppStore = create<AppState>((set) => ({
    projects: [],
    isLoading: false,
    activeProject: null,

    fetchProjects: async () => {
        set({ isLoading: true });
        try {
            const projects = await invokeCommand<Project[]>('list_projects');
            set({ projects });
        } catch {
            // silent — UI shows stale data
        } finally {
            set({ isLoading: false });
        }
    },

    createProject: async (name, path) => {
        set({ isLoading: true });
        try {
            await invokeCommand('create_project', { name, path });
            const projects = await invokeCommand<Project[]>('list_projects');
            set({ projects });
        } finally {
            set({ isLoading: false });
        }
    },

    updateProject: async (id, name, path) => {
        set({ isLoading: true });
        try {
            await invokeCommand('update_project', { id, name, path });
            const projects = await invokeCommand<Project[]>('list_projects');
            set({ projects });
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
        } finally {
            set({ isLoading: false });
        }
    },

    setActiveProject: (id) => set({ activeProject: id }),

    updateProjectSettings: async (id, settings) => {
        await invokeCommand('update_project_settings', { id, settings });
        const projects = await invokeCommand<Project[]>('list_projects');
        set({ projects });
    },
}));
