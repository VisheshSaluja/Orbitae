import React, { useState, useRef, useEffect } from 'react';
import { AgentEngine } from '../../lib/agent/AgentEngine';
import { Send, Bot, User } from 'lucide-react';

interface AgentPanelProps {
    projectId: string;
    project: { id: string; name: string; path: string };
}

export const AgentPanel: React.FC<AgentPanelProps> = ({ project }) => {
    const [messages, setMessages] = useState<{ role: 'user' | 'agent', content: string }[]>([]);
    const [input, setInput] = useState('');
    const [isThinking, setIsThinking] = useState(false);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    
    // In a real app we'd fetch this from settings, hardcoding for demo/MVP
    // In Switchboard we typically don't have this yet, so we just instantiate.
    const agentEngine = React.useMemo(() => new AgentEngine(localStorage.getItem('openAIKey') || 'sk-placeholder'), []);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    };

    useEffect(() => {
        scrollToBottom();
    }, [messages, isThinking]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!input.trim() || isThinking) return;

        const userMsg = input.trim();
        setInput('');
        setMessages(prev => [...prev, { role: 'user', content: userMsg }]);
        setIsThinking(true);

        // Add a placeholder for agent's evolving thought process
        setMessages(prev => [...prev, { role: 'agent', content: '' }]);

        try {
            await agentEngine.runPlaybookGeneration(
                userMsg, 
                { id: project.id, name: project.name, path: project.path }, 
                (updateMsg) => {
                    setMessages(prev => {
                        const newMsgs = [...prev];
                        const lastMsg = newMsgs[newMsgs.length - 1];
                        if (lastMsg.role === 'agent') {
                            lastMsg.content += lastMsg.content ? `\n${updateMsg}` : updateMsg;
                        }
                        return newMsgs;
                    });
                }
            );

            // Final success
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error);
            setMessages(prev => {
                        const newMsgs = [...prev];
                        const lastMsg = newMsgs[newMsgs.length - 1];
                        if (lastMsg.role === 'agent') {
                            lastMsg.content += `\n❌ Failed: ${message}`;
                        }
                        return newMsgs;
                    });
        } finally {
            setIsThinking(false);
        }
    };

    return (
        <div className="flex flex-col h-full bg-background border-r border-border/40">
            <div className="p-4 border-b border-border/40 bg-muted/10 flex items-center justify-between">
                <div>
                    <h3 className="text-sm font-medium flex items-center gap-2">
                        <Bot className="w-4 h-4 text-primary" />
                        AI Orchestration
                    </h3>
                    <p className="text-xs text-muted-foreground mt-1">
                        Describe how to start this project, and the AI will create a playbook.
                    </p>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {messages.length === 0 && (
                    <div className="flex flex-col items-center justify-center h-full text-center text-muted-foreground space-y-4">
                        <div className="p-4 rounded-full bg-primary/10">
                            <Bot className="w-8 h-8 text-primary" />
                        </div>
                        <p className="max-w-xs text-sm">
                            Try asking: "Start the database container, wait for it, then run the backend."
                        </p>
                    </div>
                )}
                {messages.map((msg, idx) => (
                    <div key={idx} className={`flex gap-3 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                        {msg.role === 'agent' && (
                            <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center shrink-0">
                                <Bot className="w-4 h-4 text-primary" />
                            </div>
                        )}
                        <div className={`px-4 py-2 rounded-lg max-w-[80%] whitespace-pre-wrap font-mono text-sm ${
                            msg.role === 'user' 
                                ? 'bg-primary text-primary-foreground' 
                                : 'bg-muted/50 border border-border'
                        }`}>
                            {msg.content}
                        </div>
                        {msg.role === 'user' && (
                            <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center shrink-0">
                                <User className="w-4 h-4" />
                            </div>
                        )}
                    </div>
                ))}
                
                {isThinking && (
                    <div className="flex gap-3 justify-start opacity-70">
                        <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center shrink-0">
                            <Bot className="w-4 h-4 text-primary animate-pulse" />
                        </div>
                        <div className="px-4 py-2 rounded-lg bg-muted/50 border border-border text-sm flex items-center gap-2">
                            <div className="w-2 h-2 rounded-full bg-primary animate-bounce"></div>
                            <div className="w-2 h-2 rounded-full bg-primary animate-bounce delay-75"></div>
                            <div className="w-2 h-2 rounded-full bg-primary animate-bounce delay-150"></div>
                        </div>
                    </div>
                )}
                <div ref={messagesEndRef} />
            </div>

            <div className="p-4 border-t border-border/40 bg-background/50 backdrop-blur-sm">
                <form onSubmit={handleSubmit} className="relative flex items-center">
                    <input
                        type="text"
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        placeholder="Instruct the AI to start your environment..."
                        className="w-full bg-muted border border-border rounded-lg pl-4 pr-12 py-3 text-sm focus:outline-none focus:ring-1 focus:ring-primary/50"
                        disabled={isThinking}
                    />
                    <button 
                        type="submit"
                        disabled={!input.trim() || isThinking}
                        className="absolute right-2 p-1.5 rounded-md text-muted-foreground hover:text-primary hover:bg-muted/80 disabled:opacity-50 transition-colors"
                    >
                        <Send className="w-4 h-4" />
                    </button>
                </form>
            </div>
        </div>
    );
};
