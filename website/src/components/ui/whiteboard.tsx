import React from 'react';

interface WhiteboardEditorProps {
    initialData: string;
    onChange: (data: string) => void;
    editable?: boolean;
}

export const WhiteboardEditor: React.FC<WhiteboardEditorProps> = ({ initialData, onChange, editable }) => {
    return (
        <div className="w-full h-full flex flex-col items-center justify-center bg-muted/20 border-2 border-dashed rounded-lg">
             <div className="text-center p-8">
                <p className="text-muted-foreground font-medium">Whiteboard Demo</p>
                <p className="text-xs text-muted-foreground/60 mt-1">Canvas interactions are simulated in this demo.</p>
             </div>
        </div>
    );
};
