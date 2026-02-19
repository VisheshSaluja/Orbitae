import { create } from 'zustand';

interface AppState {
    projects: any[];
    updateProjectSettings: (id: string, settings: string) => Promise<void>;
}

export const useAppStore = create<AppState>((set) => ({
    projects: [
        {
            id: 'demo-1',
            name: 'orbitae-core',
            settings: JSON.stringify({
                note_labels: {
                    yellow: 'General',
                    blue: 'Idea',
                    red: 'Bug'
                }
            })
        }
    ],
    updateProjectSettings: async (id, settings) => {
        console.log('Update settings:', id, settings);
    }
}));
