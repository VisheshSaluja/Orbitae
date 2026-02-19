import React from 'react';
import { Textarea } from './textarea';
import { cn } from '../../lib/utils';

interface EditorProps {
    content: string;
    onChange: (content: string) => void;
    projectId?: string;
    editable?: boolean;
    className?: string;
}

export const Editor: React.FC<EditorProps> = ({ content, onChange, editable = true, className }) => {
    if (!editable) {
        return <div className={cn("p-4 prose dark:prose-invert", className)}>{content}</div>;
    }
    return (
        <Textarea 
            value={content} 
            onChange={e => onChange(e.target.value)} 
            className={cn("w-full h-full min-h-[300px] p-4 font-mono text-sm resize-none bg-transparent border-0 focus-visible:ring-0", className)}
            placeholder="Write your note here..."
        />
    );
};
