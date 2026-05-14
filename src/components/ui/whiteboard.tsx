import React, { useState, useEffect } from 'react';
import { Excalidraw } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css"; // Crucial for styling

interface WhiteboardEditorProps {
    initialData?: string;
    onChange?: (data: string) => void;
    editable?: boolean;
}

export const WhiteboardEditor: React.FC<WhiteboardEditorProps> = ({ initialData, onChange, editable = true }) => {
    // Fallback theme detection or default to light for now to fix build
    const [theme, setTheme] = useState<'light' | 'dark'>('light');
    
    // Simple dark mode detection
    useEffect(() => {
        if (document.documentElement.classList.contains('dark')) {
            setTheme('dark');
        }
    }, []);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [elements, setElements] = useState<readonly any[]>([]);
    
    useEffect(() => {
        if (initialData) {
            try {
                const parsed = JSON.parse(initialData);
                if (Array.isArray(parsed)) {
                     setElements(parsed);
                }
            } catch (e) {
                console.error("Failed to parse whiteboard data", e);
            }
        }
    }, [initialData]);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handleChange = (elements: readonly any[]) => {
        if (onChange) {
            const data = JSON.stringify(elements);
            onChange(data);
        }
    };

    return (
        <div className="h-full w-full border rounded-md overflow-hidden bg-background isolate relative">
             {/* isolate class helps with z-index stacking context */}
             <Excalidraw 
                theme={theme}
                initialData={{ elements }}
                onChange={handleChange}
                viewModeEnabled={!editable}
                UIOptions={{
                    canvasActions: {
                        loadScene: false,
                        saveToActiveFile: false,
                        export: { saveFileToDisk: true },
                        saveAsImage: true,
                        changeViewBackgroundColor: true,
                        toggleTheme: true,
                    }
                }}
             >
             </Excalidraw>
        </div>
    );
};
